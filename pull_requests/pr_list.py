#!/usr/bin/env python3

import sqlite3, json, sys, cgi

PR_URL = 'https://github.com/rust-lang/rust/pull/%d'
HASH_URL = 'https://github.com/rust-lang/rust/commit/%s'
db = sqlite3.connect('../backend/pr.sqlite3')

cur = db.cursor()

def elem(name, text, attrs={}):
    return '<{name} {attrs}>{text}</{name}>'.format(
        name=name,
        text=text,
        attrs=' '.join('%s="%s"' % (k,v) for k, v in sorted(attrs.items()) if v is not None)
    )
def a(text, href=None, attrs=None):
    if attrs is None:
        attrs = {}
    attrs['href'] = href
    return elem('a', text, attrs)

def tr(texts, k=None, i=None):
    return elem('tr', ''.join(texts), {'class': k, 'id': i})
def td(text, k=None, i=None):
    return elem('td', text, {'class': k, 'id': i})
def draw_row(pr, time, changeset, title):
    cols = [td(a(str(pr), PR_URL % pr), 'pr-number'),
            td(title, 'pr-title'),
            td(str(time), 'pr-time'),
            td(a(changeset[:8], HASH_URL % changeset), 'pr-hash'),
            td(a('mem', '../mem/#%s' % changeset) + ' ' +
               a('buildbot', '../buildbot/#%s' % changeset), 'pr-graphs')]
    return tr(cols, 'pr', 'pr-%d' % pr)

cur.execute('''
SELECT STRFTIME('%%Y-%%m-%%d %%H:%%M', time, 'unixepoch'), changeset, pull_request
FROM change
WHERE datetime(time, 'unixepoch', 'utc') >= datetime('now', 'utc', '-%d day') AND
      pull_request IS NOT NULL
ORDER BY time DESC
LIMIT 500''' % 8)

formatted = []
for time, changeset, pr in cur:
    dir = '%02d/%d' % (pr // 100, pr)
    try:
        title = open('%s/title.txt' % dir).read()
        title = cgi.escape(title) # no injection here.
    except Exception as e:
        title = '<small>Unknown</small>'

    formatted.append(draw_row(pr, time, changeset, title))

template = open('index.html.template').read()
with open('index.html', 'w') as f:
    f.write(template.replace('{{DATA_HERE}}', '\n'.join(formatted)))
