import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import EmojiPicker, { type EmojiClickData } from "emoji-picker-react";
import { newItemId, useDeletePage, useEditPage, usePage, type CheckItem } from "../../lib/planner";
import { BackButton, Checklist, Progress } from "./parts";
import { confirmDialog } from "../../components/ConfirmDialog";
import { RichText } from "../../components/RichText";

export function PageView() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: serverPage, isLoading } = usePage(id);
  const [page, edit] = useEditPage(id, serverPage);
  const deletePage = useDeletePage();
  const [pickerOpen, setPickerOpen] = useState(false);

  if (isLoading) return <p className="page-loading">Loading…</p>;
  if (!page) return <div className="mi-narrow"><BackButton /><p className="muted">Page not found.</p></div>;

  const done = page.checklist.filter((c) => c.done).length;

  async function remove() {
    if (!page || !(await confirmDialog({ title: `Delete "${page.title || "Untitled"}"?`, body: "This can't be undone.", confirmLabel: "Delete page", danger: true }))) return;
    deletePage.mutate(page.id, { onSuccess: () => navigate("/mainichi", { replace: true }) });
  }

  return (
    <div className="mi-narrow mi-doc">
      <BackButton />
      <header className="mi-dochead">
        <div className="mi-iconpick">
          <button
            type="button"
            className="mi-iconpick__btn"
            aria-label={`Change icon, currently ${page.icon}`}
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen((v) => !v)}
          >
            {page.icon}
          </button>
          {pickerOpen && (
            <div className="mi-iconpick__pop">
              <EmojiPicker
                open
                width="100%"
                height={340}
                skinTonesDisabled
                previewConfig={{ showPreview: false }}
                onEmojiClick={(data: EmojiClickData) => {
                  edit((p) => ({ ...p, icon: data.emoji }), 0);
                  setPickerOpen(false);
                }}
              />
            </div>
          )}
        </div>
        <input
          className="mi-title"
          value={page.title}
          placeholder="Untitled"
          aria-label="Page title"
          onChange={(e) => {
            const title = e.target.value;
            edit((p) => ({ ...p, title }));
          }}
        />
        <textarea
          className="mi-notes mi-desc"
          value={page.description}
          placeholder="Add a description…"
          aria-label="Description"
          onChange={(e) => {
            const description = e.target.value;
            edit((p) => ({ ...p, description }));
          }}
        />
      </header>

      <section className="mi-docsec">
        <div className="mi-cardhead">
          <h2 className="mi-h2">Checklist</h2>
          {page.checklist.length > 0 && <span className="mi-muted">{done}/{page.checklist.length}</span>}
          <div className="mi-top__spacer" />
          {done > 0 && (
            <button
              type="button"
              className="mi-pill"
              onClick={() => edit((p) => ({ ...p, checklist: p.checklist.map((c) => ({ ...c, done: false })) }), 150)}
            >
              Uncheck all
            </button>
          )}
        </div>
        {page.checklist.length > 0 && <Progress done={done} total={page.checklist.length} />}
        <Checklist
          items={page.checklist}
          onChange={(checklist: CheckItem[], delay) => edit((p) => ({ ...p, checklist }), delay)}
          makeItem={(text) => ({ id: newItemId(), text, done: false })}
        />
      </section>

      <section className="mi-docsec">
        <h2 className="mi-h2">Notes</h2>
        <RichText
          className="mi-richnotes"
          value={page.notes}
          placeholder="Write anything… (- for a list)"
          aria-label="Notes"
          onChange={(notes) => edit((p) => ({ ...p, notes }))}
        />
      </section>

      {deletePage.error && <p className="field-error">{deletePage.error.message}</p>}
      <div className="mi-docfoot">
        <span className="mi-muted">Edited {new Date(page.updated_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
        <button type="button" className="btn btn--ghost-danger btn--sm" onClick={remove} disabled={deletePage.isPending}>Delete page</button>
      </div>
    </div>
  );
}
