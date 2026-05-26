import re, glob

MAPPING = {
    '8':'3xs','9':'2xs','10':'xs','11':'sm','12':'base',
    '13':'md','14':'lg','16':'xl','18':'2xl','22':'3xl','24':'4xl'
}
PATTERN = re.compile(r'(fontSize:\s*)(\d+)(?![0-9a-zA-Z%\.])')

def replacer(m):
    n = m.group(2)
    return f'{m.group(1)}"var(--font-size-{MAPPING[n]})"' if n in MAPPING else m.group(0)

changed, total = [], 0
for path in sorted(glob.glob('apps/admin/src/**/*.tsx', recursive=True)):
    with open(path) as f:
        content = f.read()
    new = PATTERN.sub(replacer, content)
    if new != content:
        count = sum(1 for m in PATTERN.finditer(content) if m.group(2) in MAPPING)
        with open(path, 'w') as f:
            f.write(new)
        changed.append((path, count))
        total += count

print(f"Done: {len(changed)} files, {total} replacements")
for path, n in changed:
    print(f"  {n:4d}  {path}")
