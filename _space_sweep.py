import re, glob

TOKENS = {1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 24, 32}

PROPS = '|'.join([
    'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
    'paddingInline', 'paddingBlock',
    'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
    'marginInline', 'marginBlock',
    'padding', 'margin', 'gap', 'rowGap', 'columnGap',
])
PATTERN = re.compile(r'((?:' + PROPS + r'):\s*)(\d+)(?![0-9a-zA-Z%\.])')

def replacer(m):
    n = int(m.group(2))
    return f'{m.group(1)}"var(--space-{n})"' if n in TOKENS else m.group(0)

changed, total = [], 0
for path in sorted(glob.glob('apps/admin/src/**/*.tsx', recursive=True)):
    with open(path) as f:
        content = f.read()
    new = PATTERN.sub(replacer, content)
    if new != content:
        count = sum(1 for m in PATTERN.finditer(content) if int(m.group(2)) in TOKENS)
        with open(path, 'w') as f:
            f.write(new)
        changed.append((path, count))
        total += count

print(f"Done: {len(changed)} files, {total} replacements")
for path, n in changed:
    print(f"  {n:4d}  {path}")
