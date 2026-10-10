import type { FileEntry } from "@understudy/protocol";

export type OutputArtifact = { id: string; title: string; name: string; latestVersion: number; updatedAt: string };

export type OutputItem =
  | { kind: "artifact"; key: string; at: number; artifact: OutputArtifact }
  | { kind: "file"; key: string; at: number; file: FileEntry };

const baseName = (path: string) => path.split("/").pop() ?? path;

export function latestDeliveries(artifacts: OutputArtifact[], files: FileEntry[], count = 3): OutputItem[] {
  const published = new Set(artifacts.map((artifact) => baseName(artifact.name)));
  const items: OutputItem[] = [
    ...artifacts.map((artifact) => ({ kind: "artifact" as const, key: `artifact:${artifact.id}`, at: Date.parse(artifact.updatedAt) || 0, artifact })),
    ...files.filter((file) => !published.has(baseName(file.path))).map((file) => ({ kind: "file" as const, key: `file:${file.path}`, at: file.updatedAt, file })),
  ];
  return items.sort((x, y) => y.at - x.at).slice(0, count);
}

export function latestOutputs(files: FileEntry[], count = 3) {
  return [...files].sort((x, y) => y.updatedAt - x.updatedAt).slice(0, count);
}

export function fileKind(path: string) {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  if (["xls", "xlsx", "csv", "ods"].includes(ext)) return { label: "XLS", tone: "sheet" };
  if (["doc", "docx", "md", "txt", "odt", "rtf"].includes(ext)) return { label: "DOC", tone: "doc" };
  if (ext === "pdf") return { label: "PDF", tone: "pdf" };
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return { label: "IMG", tone: "img" };
  if (["ppt", "pptx", "key", "odp"].includes(ext)) return { label: "PPT", tone: "deck" };
  if (["html", "htm"].includes(ext)) return { label: "WEB", tone: "deck" };
  if (["mp4", "mov", "webm"].includes(ext)) return { label: "VID", tone: "img" };
  return { label: ext.slice(0, 3).toUpperCase() || "FILE", tone: "other" };
}
