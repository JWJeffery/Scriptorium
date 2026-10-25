"use client";

import { useState } from "react";

type Props = {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
  disabled?: boolean;
};

export function normalizeTags(tags: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/^#/, "").slice(0, 60);
    const key = tag.toLowerCase();
    if (tag && !seen.has(key)) { seen.add(key); result.push(tag); }
  }
  return result.slice(0, 50);
}

/** Tag chips: type a tag and press Enter or comma; click a suggestion to reuse one. */
export function TagInput({ value, onChange, suggestions, disabled }: Props) {
  const [draft, setDraft] = useState("");

  function commit(text: string) {
    const parts = text.split(",");
    if (parts.every((part) => !part.trim())) { setDraft(""); return; }
    onChange(normalizeTags([...value, ...parts]));
    setDraft("");
  }

  const unused = suggestions.filter((tag) => !value.some((chosen) => chosen.toLowerCase() === tag.toLowerCase())).slice(0, 8);

  return (
    <div className="tagInput">
      <span className="tagInputLabel">Tags</span>
      <div className="tagChips">
        {value.map((tag) => (
          <span className="tagChip" key={tag}>
            #{tag}
            <button type="button" onClick={() => onChange(value.filter((item) => item !== tag))} aria-label={`Remove tag ${tag}`} disabled={disabled}>×</button>
          </span>
        ))}
        <input
          value={draft}
          disabled={disabled}
          placeholder={value.length ? "" : "Add a tag, e.g. ecclesiology"}
          aria-label="Add a tag"
          onChange={(event) => { if (event.target.value.includes(",")) commit(event.target.value); else setDraft(event.target.value); }}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); commit(draft); }
            else if (event.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => commit(draft)}
        />
      </div>
      {unused.length > 0 ? (
        <div className="tagSuggestions" aria-label="Tags you have used">
          {unused.map((tag) => <button type="button" key={tag} onClick={() => onChange(normalizeTags([...value, tag]))} disabled={disabled}>+ {tag}</button>)}
        </div>
      ) : null}
    </div>
  );
}
