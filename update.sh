#!/bin/bash
git pull --rebase

(
    cd buildbot

    ./build-perf.py &&
      ./make-perf-json.py &&
      ./make-perf-json.py all &&
      git add {perf,all}.js &&
      git commit -m 'Update buildbot.'
)
(
    cd mem
    rustc -O process.rs &&
      ./dl.sh &&
      ./process &&
      git add out/*.json &&
      git commit -m 'Update mem. '
)

git push
