export function slugify(text: string, max = 40): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return slug || "mission";
}

export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

export function branchName(missionSlug: string, label: string): string {
  return `director/${missionSlug}/${slugify(label, 30)}`;
}

export function clip(text: string, max: number): string {
  const flat = text.trim();
  return flat.length <= max ? flat : flat.slice(0, max - 1).trimEnd() + "…";
}
