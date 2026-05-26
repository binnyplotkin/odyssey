import re, glob

MAPPING = {
    '2':   '2xs',
    '4':   'xs',
    '6':   'sm',
    '8':   'md',
    '10':  'lg',
    '12':  'xl',
    '14':  '2xl',
    '16':  '3xl',
    '18':  'card',
    '20':  'panel',
    '24':  'floating',
    '999': 'pill',
}

PROPS = '|'.join([
    'borderTopLeftRadius', 'borderTopRightRadius',
    'borderBottomLeftRadius', 'borderBottomRightRadius',
    'borderRadius',
])
PATTERN = re.compile(r'((?:' + PROPS + r'):\s*)(\d+)(?![0-9a-zA-Z%\.])')

def replacer(m):
    n = m.group(2)
    if n not in MAPPING:
        return m.group(0)
    return f'{m.group(1)}"var(--radius-{MAPPING[n]})"'

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
