// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

import { useEffect, useState } from "react";
import { Button, Field, Input, MessageBar, MessageBarBody, Radio, RadioGroup, Select, Switch } from "@fluentui/react-components";
import { parseDecisionXml } from "@toolbox/visual-routing-tester/src/ruleXml";
import { routeToQueueRuleset } from "../admin/actions";
import { useStoreVersion, useTraining } from "../shell/context";
import { Ivr } from "../lessons/checks";
import { aiCaller, aiStatus, Caller } from "../scenarios/client";
import { Store } from "../simulator/store";
import { CallResult, CallTime, DAYS, describeTime, endingOf, lineOf, placeCall } from "./engine";
import { callerNumbers } from "./customers";
import { UNKNOWN_NUMBER } from "../simulator/seeds/customers";
import { canSpeak, Line, setSpeechOn, speak, speechOn } from "./speech";

// The phone: dial a simulated number, answer the IVR, and follow the call step by step. Numbers are
// only ever the simulated environment's, which are all in ranges reserved for fiction.
//
// The guided lesson scripts its line's IVR. Elsewhere the IVR offers the values the line's own
// route-to-queue rules check, plus "something else". The time of the call is the contact center's local
// time; without one, operating hours aren't checked. With the AI switched on, an AI caller can call.

const VARIABLE = "SelectedMenuItem";
const OTHER = "\u0000other";

// The values a line's rules compare SelectedMenuItem with, in the decision list's order.
function menuValues(store: Store, workstreamId: string): string[] {
  const ruleset = routeToQueueRuleset(store, workstreamId);
  const rules = ruleset ? parseDecisionXml(ruleset.msdyn_rulesetdefinition)?.rules ?? [] : [];
  const values = rules.flatMap((r) => r.conditions.filter((c) => c.lhs === `liveworkitemcontext.${VARIABLE}` && c.rhs !== undefined).map((c) => String(c.rhs)));
  return [...new Set(values)];
}

export function Phone({ line }: { line?: { dial: string; label: string; ivr?: Ivr } }) {
  const { sim, explain, clock, routing } = useTraining();
  useStoreVersion();
  const numbers = sim.store.table("msdyn_ocvoicechannelsetting").filter((c) => c._msdyn_phonenumberid_value)
    .map((c) => ({ channel: c.msdyn_name, number: sim.store.find("msdyn_ocphonenumber", c._msdyn_phonenumberid_value)?.msdyn_phonenumber as string }))
    .filter((n) => n.number);
  const [dial, setDial] = useState(line?.dial ?? numbers[0]?.number ?? "");
  const [answer, setAnswer] = useState("");
  const [other, setOther] = useState("");
  const [day, setDay] = useState("clock");
  // The number the caller calls from: matched to a customer when it's theirs (customers.ts).
  const [from, setFrom] = useState("");
  const [time, setTime] = useState("10:00");
  const [calls, setCalls] = useState<{ dial: string; answer: string; at?: CallTime; caller?: Caller; result: CallResult }[]>([]);
  const [busy, setBusy] = useState(false);
  const [aloud, setAloud] = useState(() => canSpeak() && speechOn());
  const [aiOn, setAiOn] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { void aiStatus().then((s) => setAiOn(!!s?.available)); }, []);

  const { workstream } = lineOf(sim.store, dial);
  const scripted = line?.ivr && workstream?.msdyn_name === line.ivr.workstream ? line.ivr : undefined;
  const hasIvr = !!workstream?._msdyn_bot_user_value;
  const ivr: Ivr | undefined = scripted ?? (hasIvr && workstream ? {
    workstream: workstream.msdyn_name, variable: VARIABLE, prompt: "What is your call about?",
    options: [...menuValues(sim.store, workstream.msdyn_liveworkstreamid).map((v) => ({ label: v, value: v })), { label: "Something else…", value: OTHER }]
  } : undefined);
  const at: CallTime | undefined = day === "clock" ? clock.callTime() : day === "" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? undefined : { day: Number(day), time };

  const call = async (caller?: Caller) => {
    setBusy(true);
    setError("");
    try {
      const value = caller ? caller.choice : answer === OTHER ? other.trim() : answer;
      const answers = ivr && value ? { [ivr.variable]: value } : {};
      // A call now goes through routing to a representative; a call at another time only shows where it would go.
      const result = await placeCall(sim.store, { dial, from: from || undefined, answers, at }, day === "clock" ? { record: true, now: clock.now(), routing } : { record: false });
      const label = ivr?.options.find((o) => o.value === value)?.label ?? value;
      setCalls((c) => [{ dial, answer: label, at, caller, result }, ...c]);
      if (aloud) {
        const lines: Line[] = [];
        if (ivr) lines.push({ who: "ivr", text: ivr.prompt });
        if (caller) lines.push({ who: "caller", text: caller.says });
        else if (label) lines.push({ who: "caller", text: label });
        const last = result.steps[result.steps.length - 1];
        if (last) lines.push({ who: "narrator", text: last.detail });
        speak(lines);
      }
      explain(result.steps.some((s) => s.what === "Overflow") ? "overflow" : result.steps.some((s) => /fallback queue/.test(s.detail)) ? "fallback-queue" : "route-to-queue");
    } finally {
      setBusy(false);
    }
  };

  const callAsAi = async () => {
    setBusy(true);
    setError("");
    try {
      const caller = await aiCaller(dial);
      await call(caller);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="phone">
      <div className="phone-pad">
        <h2 className="phone-title">Phone</h2>
        <Field label="Number to call" hint={line && dial === line.dial ? line.label : undefined}>
          <Input value={dial} onChange={(_, v) => { setDial(v.value); setAnswer(""); }} />
        </Field>
        <Field label="Call from" hint="The customer's number. A number that matches one contact or account links the call to that customer.">
          <Select value={from} onChange={(_, d) => setFrom(d.value)}>
            <option value="">Number withheld</option>
            {callerNumbers(sim.store).map((n) => <option key={n.number} value={n.number}>{n.label}</option>)}
            <option value={UNKNOWN_NUMBER}>{UNKNOWN_NUMBER} · not a customer</option>
          </Select>
        </Field>
        <details className="phone-numbers">
          <summary>Numbers in this environment ({numbers.length})</summary>
          {numbers.map((n) => <button key={n.number} className="admin-link" onClick={() => { setDial(n.number); setAnswer(""); }}>{n.number} · {n.channel}</button>)}
        </details>
        {ivr && (
          <div className="phone-ivr">
            <p className="phone-says"><span>IVR</span>“{ivr.prompt}”</p>
            <RadioGroup value={answer} onChange={(_, v) => setAnswer(v.value)}>
              {ivr.options.map((o) => <Radio key={o.value} value={o.value} label={o.label} />)}
            </RadioGroup>
            {answer === OTHER && <Input aria-label="What the caller says" placeholder="What the caller chooses" value={other} onChange={(_, v) => setOther(v.value)} />}
          </div>
        )}
        <div className="phone-time">
          <Field label="When">
            <Select value={day} onChange={(_, d) => setDay(d.value)}>
              <option value="clock">Now, by the clock</option>
              <option value="">Time doesn't matter</option>
              {DAYS.map((d, i) => <option key={d} value={String(i)}>{d}</option>)}
            </Select>
          </Field>
          {day !== "" && day !== "clock" && <Field label="Time"><Input type="time" value={time} onChange={(_, v) => setTime(v.value)} /></Field>}
        </div>
        <Button appearance="primary" disabled={busy || !dial.trim() || (!!ivr && (!answer || (answer === OTHER && !other.trim())))} onClick={() => void call()}>Call</Button>
        {aiOn && <Button disabled={busy || !dial.trim()} onClick={() => void callAsAi()}>Let an AI caller call</Button>}
        {canSpeak() && <Switch label="Read the call aloud" checked={aloud} onChange={(_, d) => { setAloud(d.checked); setSpeechOn(d.checked); }} />}
        {error && <p className="lesson-problem">{error}</p>}
        <p className="admin-muted phone-note">Simulated: no real call is made. The numbers are fictional. Times are the contact center's local time. Only a call made now reaches a representative; a call at another time shows where it would go.</p>
      </div>
      <div className="phone-log">
        {!calls.length && <p className="admin-muted">Your calls appear here, step by step.</p>}
        {calls.map((c, i) => (
          <div key={calls.length - i} className="phone-call">
            <div className="phone-call-head">
              <strong>Call to {c.dial}{c.answer ? ` · chose ${c.answer}` : ""}{c.at ? ` · ${describeTime(c.at)}` : ""}</strong>
              {c.result.queue && c.result.outcome
                ? <span className={`phone-badge${c.result.outcome === "Agent" ? "" : " other"}`}>{c.result.outcome === "Agent" ? `Waiting in ${c.result.queue.name}` : `${c.result.queue.name}: ${endingOf(c.result.outcome)}`}</span>
                : <span className="phone-badge stop">Not connected</span>}
            </div>
            {c.caller && <p className="phone-caller"><span>AI caller</span>{c.caller.name} ({c.caller.mood}): “{c.caller.says}”</p>}
            <ol className="phone-steps">
              {c.result.steps.map((s, j) => <li key={j} className={s.status}><strong>{s.what}</strong> {s.detail}</li>)}
            </ol>
          </div>
        ))}
        {calls.length > 0 && <MessageBar intent="info"><MessageBarBody>A call made now goes to a representative who's free, or waits in the queue. Sign in as a representative on the Agent tab to take calls yourself. The Diagram's Live tab shows the calls.</MessageBarBody></MessageBar>}
      </div>
    </div>
  );
}
