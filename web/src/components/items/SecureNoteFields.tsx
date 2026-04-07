import type { SecureNoteData } from "@/shared/types/item-data";
import { Field } from "./FieldGroup";

interface Props {
  data: SecureNoteData;
  onChange: (data: SecureNoteData) => void;
}

export function SecureNoteFields({ data, onChange }: Props) {
  const set = <K extends keyof SecureNoteData>(key: K, value: SecureNoteData[K]) =>
    onChange({ ...data, [key]: value });

  return (
    <div className="space-y-4">
      <Field label="Content" value={data.content} onChange={(v) => set("content", v)} type="textarea" />
      <Field label="Notes" value={data.notes} onChange={(v) => set("notes", v)} type="textarea" />
    </div>
  );
}
