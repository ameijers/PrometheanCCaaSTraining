// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: LicenseRef-All-Rights-Reserved

import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, MessageBar, MessageBarBody } from "@fluentui/react-components";
import { Store } from "../simulator/store";
import { exportDesign } from "./toolboxExport";

// "Export for the Toolbox" (manual 9.5): what the learner built, as the Toolbox's CSV templates, one file per
// tool, plus what the templates can't carry.
export function ExportDialog({ store, start, onClose }: { store: Store; start: Store; onClose(): void }) {
  const result = exportDesign(store, start);
  const save = (name: string, csv: string) => {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Dialog open onOpenChange={(_, d) => { if (!d.open) onClose(); }}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Export for the Toolbox</DialogTitle>
          <DialogContent>
            <p>
              What you built here, as the Promethean CCaaS Toolbox's CSV templates. In a real environment, go down the list in this order: open each tool,
              load its file, check the plan and run it. Only what's new compared with the start of the exercise is in the files.
            </p>
            {result.files.length ? (
              <ul className="export-files">
                {result.files.map((f) => (
                  <li key={f.fileName}>
                    <span><strong>{f.tool}</strong> · {f.fileName} · {f.rows} row{f.rows === 1 ? "" : "s"}</span>
                    <Button size="small" onClick={() => save(f.fileName, f.csv)}>Download</Button>
                  </li>
                ))}
              </ul>
            ) : (
              <MessageBar intent="info">
                <MessageBarBody>
                  {result.notExported.length
                    ? "No files this time: what you changed has no Toolbox template. Below is what to do in the admin center instead."
                    : "Nothing to export yet: build something in the admin center first."}
                </MessageBarBody>
              </MessageBar>
            )}
            {result.notExported.length > 0 && (
              <>
                <h3 className="export-subtitle">Not in the files</h3>
                <ul className="export-notes">{result.notExported.map((n) => <li key={n}>{n}</li>)}</ul>
              </>
            )}
            <p className="export-muted">The phone numbers in the files are the training's fictional numbers: replace them with your own before you run the voice tools (Voice Workstream Builder, Voice Channel Builder, Profile Builder).</p>
          </DialogContent>
          <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
