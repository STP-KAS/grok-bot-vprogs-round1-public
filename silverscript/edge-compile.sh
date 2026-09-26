#!/bin/bash
# SilverScript v1.0.0 (3ed9733) silverc: DeskFloor with edge constructor args and pragma variants.
S=${SILVERC:-/workspace/silverscript-v1/target/release/silverc}
body='contract DeskFloor(int floor) {
    entry check(int n) {
        require(n >= floor);
    }
}'
t() { # name, source, ctor-json
  printf '%s\n' "$2" > /tmp/sil-case.sil; printf '%s' "$3" > /tmp/sil-case.args.json
  out=$($S /tmp/sil-case.sil --ctor /tmp/sil-case.args.json -c 2>&1); rc=$?
  if [ $rc -eq 0 ]; then bc=$(printf '%s' "$out" | python3 -c "import json,sys;d=json.load(sys.stdin);print(bytes(d['contracts']['DeskFloor']['compiled']['bytecode']).hex())" 2>/dev/null); echo "$1 | exit=0 | bytecode=$bc"; else echo "$1 | exit=$rc | $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-220)"; fi
}
P='pragma silverscript ^0.1.0;'
t "ctor floor=1 (desk)"            "$P$body" '[{"kind":"int","value":1}]'
t "ctor floor=0"                   "$P$body" '[{"kind":"int","value":0}]'
t "ctor floor=-1"                  "$P$body" '[{"kind":"int","value":-1}]'
t "ctor floor=16"                  "$P$body" '[{"kind":"int","value":16}]'
t "ctor floor=17"                  "$P$body" '[{"kind":"int","value":17}]'
t "ctor floor=2^31"                "$P$body" '[{"kind":"int","value":2147483648}]'
t "ctor floor=2^63-1"              "$P$body" '[{"kind":"int","value":9223372036854775807}]'
t "ctor floor=-2^63"               "$P$body" '[{"kind":"int","value":-9223372036854775808}]'
t "ctor floor=2^63 (overflow)"     "$P$body" '[{"kind":"int","value":9223372036854775808}]'
t "ctor floor=1.5 (float)"         "$P$body" '[{"kind":"int","value":1.5}]'
t "ctor floor=\"7\" (string)"      "$P$body" '[{"kind":"int","value":"7"}]'
t "ctor kind=bool"                 "$P$body" '[{"kind":"bool","value":true}]'
t "ctor missing"                   "$P$body" '[]'
t "ctor extra arg"                 "$P$body" '[{"kind":"int","value":1},{"kind":"int","value":2}]'
t "ctor not JSON"                  "$P$body" 'nope'
t "pragma ^0.1.0"                  "$P$body" '[{"kind":"int","value":1}]'
t "pragma ^1.0.0"                  "pragma silverscript ^1.0.0;$body" '[{"kind":"int","value":1}]'
t "pragma ^0.2.0"                  "pragma silverscript ^0.2.0;$body" '[{"kind":"int","value":1}]'
t "pragma =0.1.0"                  "pragma silverscript =0.1.0;$body" '[{"kind":"int","value":1}]'
t "pragma >=0.1.0"                 "pragma silverscript >=0.1.0;$body" '[{"kind":"int","value":1}]'
t "pragma 0.1.0 (bare)"            "pragma silverscript 0.1.0;$body" '[{"kind":"int","value":1}]'
t "pragma ^0.0.1"                  "pragma silverscript ^0.0.1;$body" '[{"kind":"int","value":1}]'
t "pragma ^0.1 (short)"            "pragma silverscript ^0.1;$body" '[{"kind":"int","value":1}]'
t "pragma garbage"                 "pragma silverscript ^banana;$body" '[{"kind":"int","value":1}]'
t "pragma missing semicolon"       "pragma silverscript ^0.1.0 $body" '[{"kind":"int","value":1}]'
t "no pragma"                      "$body" '[{"kind":"int","value":1}]'
t "two pragmas"                    "$P$P$body" '[{"kind":"int","value":1}]'
t "require on undefined name"      "${P}contract DeskFloor(int floor) { entry check(int n) { require(m >= floor); } }" '[{"kind":"int","value":1}]'
t "empty entry"                    "${P}contract DeskFloor(int floor) { entry check(int n) { } }" '[{"kind":"int","value":1}]'
