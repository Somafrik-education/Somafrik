import { useEffect, useRef } from "react";
import grapesjs, { type Editor } from "grapesjs";
import "grapesjs/dist/css/grapes.min.css";
import type { BulletinClassDesign } from "../../lib/bulletinDesign";
import {
  BULLETIN_TEMPLATE_TOKENS,
  DEFAULT_BULLETIN_BODY_HTML,
  DEFAULT_BULLETIN_CSS,
} from "../../lib/bulletinGrapesTemplate";

export interface BulletinEditorExport {
  htmlTemplate: string;
  cssTemplate: string;
  grapesProject: Record<string, unknown>;
}

interface BulletinGrapesEditorProps {
  designKey: string;
  design: BulletinClassDesign;
  onExport: (payload: BulletinEditorExport) => void;
}

function registerBulletinBlocks(editor: Editor) {
  const blockManager = editor.BlockManager;
  blockManager.add("bulletin-section", {
    label: "Section bulletin",
    category: "Structure",
    content: `<section style="padding:12px;border:1px dashed #cbd5e1;border-radius:8px;margin:8px 0;">
      <h3 style="margin:0 0 8px;font-size:14px;">Nouvelle section</h3>
      <p style="margin:0;color:#64748b;">Contenu personnalisable</p>
    </section>`,
  });

  for (const item of BULLETIN_TEMPLATE_TOKENS) {
    blockManager.add(`token-${item.id}`, {
      label: item.label,
      category: "Données dynamiques",
      content: `<span data-bulletin-token="${item.id}" style="display:inline-block;padding:2px 6px;background:#ecfdf5;border:1px solid #99f6e4;border-radius:4px;font-family:monospace;font-size:11px;">${item.token}</span>`,
    });
  }
}

function loadEditorContent(editor: Editor, design: BulletinClassDesign) {
  if (design.grapesProject && Object.keys(design.grapesProject).length) {
    editor.loadProjectData(design.grapesProject as Parameters<Editor["loadProjectData"]>[0]);
    return;
  }
  if (design.htmlTemplate?.trim()) {
    editor.setComponents(design.htmlTemplate);
    editor.setStyle(design.cssTemplate ?? DEFAULT_BULLETIN_CSS);
    return;
  }
  editor.setComponents(DEFAULT_BULLETIN_BODY_HTML);
  editor.setStyle(DEFAULT_BULLETIN_CSS);
}

export function BulletinGrapesEditor({ designKey, design, onExport }: BulletinGrapesEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const onExportRef = useRef(onExport);
  onExportRef.current = onExport;

  useEffect(() => {
    if (!hostRef.current) return;

    const editor = grapesjs.init({
      container: hostRef.current,
      height: "620px",
      width: "auto",
      storageManager: false,
      fromElement: false,
      deviceManager: {
        devices: [
          { name: "A4", width: "794px" },
          { name: "Tablette", width: "768px" },
        ],
      },
    });

    registerBulletinBlocks(editor);
    loadEditorContent(editor, design);

    const publish = () => {
      onExportRef.current({
        htmlTemplate: editor.getHtml(),
        cssTemplate: editor.getCss() ?? "",
        grapesProject: editor.getProjectData() as Record<string, unknown>,
      });
    };

    editor.on("update", publish);
    publish();
    editorRef.current = editor;

    return () => {
      editor.destroy();
      editorRef.current = null;
    };
    // Recharger l'éditeur uniquement quand on change établissement/classe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designKey]);

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-white">
      <div ref={hostRef} className="min-h-[620px]" />
    </div>
  );
}
