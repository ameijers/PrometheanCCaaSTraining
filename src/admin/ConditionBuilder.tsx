// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { Button, Dropdown, Input, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, Option, OptionGroup, Tooltip } from "@fluentui/react-components";
import pagesJson from "../../content/admin-pages/pages.json";
import { ConditionGroup, ConditionRow, isGroup, OPERATORS, RuleField } from "./rules";

// The Conditions part of a rule panel, as in the admin center: a top group fixed at And, with Add (Add row,
// Add group, Add related entity), rows of Select a field, an operator and Value, and groups that can be
// And or Or. Operators follow the field's type (docs/admin-center-check.md).

const d = pagesJson.pages["decision-list"].panel;
// Learn: conditions "for up to two levels of the related records and attributes"; groups go two deep here too.
const MAX_DEPTH = 2;

type Change = (group: ConditionGroup) => void;

export function ConditionBuilder({ value, onChange, fields }: { value: ConditionGroup; onChange: Change; fields: RuleField[] }) {
  return <Group group={value} onChange={onChange} fields={fields} depth={0} />;
}

function Group({ group, onChange, onRemove, fields, depth }: { group: ConditionGroup; onChange: Change; onRemove?: () => void; fields: RuleField[]; depth: number }) {
  const set = (i: number, item: ConditionRow | ConditionGroup) => onChange({ ...group, items: group.items.map((x, j) => (j === i ? item : x)) });
  const remove = (i: number) => onChange({ ...group, items: group.items.filter((_, j) => j !== i) });
  const add = (item: ConditionRow | ConditionGroup) => onChange({ ...group, items: [...group.items, item] });
  const newRow = (): ConditionRow => ({ field: "", operator: "==", value: "" });
  return (
    <div className="admin-group-box" role="group" aria-label={depth === 0 ? "Conditions" : `${group.logic === "AND" ? d.and : d.or} group`}>
      <div className="admin-condition">
        {depth === 0
          ? <Button size="small" disabled>{d.and}</Button>
          : (
            <Dropdown aria-label="Group" size="small" className="admin-logic" value={group.logic === "AND" ? d.and : d.or} selectedOptions={[group.logic]}
              onOptionSelect={(_, o) => onChange({ ...group, logic: o.optionValue === "OR" ? "OR" : "AND" })}>
              <Option value="AND">{d.and}</Option>
              <Option value="OR">{d.or}</Option>
            </Dropdown>
          )}
        {onRemove && <Button appearance="subtle" size="small" aria-label={d.removeGroup} onClick={onRemove}>✕</Button>}
      </div>
      {group.items.map((item, i) => (isGroup(item)
        ? <Group key={i} group={item} onChange={(g) => set(i, g)} onRemove={() => remove(i)} fields={fields} depth={depth + 1} />
        : <Row key={i} row={item} onChange={(r) => set(i, r)} onRemove={() => remove(i)} fields={fields} />))}
      <Menu>
        <MenuTrigger disableButtonEnhancement><Button size="small">+ {d.add} ⌄</Button></MenuTrigger>
        <MenuPopover>
          <MenuList>
            <MenuItem onClick={() => add(newRow())}>{d.addMenu[0]}</MenuItem>
            <MenuItem disabled={depth >= MAX_DEPTH} onClick={() => add({ logic: "AND", items: [newRow()] })}>{d.addMenu[1]}</MenuItem>
            <Tooltip content={d.relatedEntityOff} relationship="description"><MenuItem disabled>{d.addMenu[2]}</MenuItem></Tooltip>
          </MenuList>
        </MenuPopover>
      </Menu>
    </div>
  );
}

function Row({ row, onChange, onRemove, fields }: { row: ConditionRow; onChange: (row: ConditionRow) => void; onRemove: () => void; fields: RuleField[] }) {
  const field = fields.find((f) => f.lhs === row.field);
  const operators = OPERATORS.filter((o) => !field || o.types.includes(field.type));
  const operator = OPERATORS.find((o) => o.xml === row.operator);
  const under = [...new Set(fields.map((f) => f.under))];
  return (
    <div className="admin-condition">
      <Dropdown aria-label="Field" placeholder={d.field} value={field?.label ?? (row.field ? row.field : "")} selectedOptions={row.field ? [row.field] : []}
        onOptionSelect={(_, o) => {
          const next = fields.find((f) => f.lhs === o.optionValue);
          const keep = next && operator && operator.types.includes(next.type);
          onChange({ ...row, field: o.optionValue ?? "", operator: keep ? row.operator : "==" });
        }}>
        {under.map((u) => (
          <OptionGroup key={u} label={u}>
            {fields.filter((f) => f.under === u).map((f) => <Option key={f.lhs} value={f.lhs}>{f.label}</Option>)}
          </OptionGroup>
        ))}
      </Dropdown>
      <Dropdown aria-label="Operator" value={operator?.label ?? ""} selectedOptions={[row.operator]} onOptionSelect={(_, o) => onChange({ ...row, operator: o.optionValue ?? "==" })}>
        {operators.map((o) => <Option key={o.xml} value={o.xml}>{o.label}</Option>)}
      </Dropdown>
      {(operator?.needsValue ?? true) && (
        <Input aria-label={d.value} placeholder={d.value} type={field?.type === "number" ? "number" : "text"} value={row.value} onChange={(_, v) => onChange({ ...row, value: v.value })} />
      )}
      <Button appearance="subtle" aria-label={d.removeRow} onClick={onRemove}>✕</Button>
    </div>
  );
}
