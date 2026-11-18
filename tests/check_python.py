"""Check the official Python port of pmsampsize against the R fixtures.

    pip install pmsampsize   # Python 3.12+
    python tests/check_python.py

Applies the workaround for pmsampsize 0.1.0's NameError (bare exp() on the
survival + Nagelkerke path), then compares every survival and binary case in
tests/fixtures.json, including the inputs R rejects.
"""
import contextlib
import io
import json
import math
import pathlib
import sys

import pmsampsize.pmsampsize as _pms

_pms.exp = math.exp  # https://github.com/RebeccaWhittle/pmsampsize/issues/1
from pmsampsize.pmsampsize import pmsampsize  # noqa: E402

fx = json.loads((pathlib.Path(__file__).parent / "fixtures.json").read_text())
bad = total = 0
for kind, rows in (("s", fx["survival"]), ("b", fx["binary"])):
    for r in rows:
        total += 1
        args = dict(type=kind, parameters=int(r["p"]), shrinkage=r["shrink"], noprint=True)
        if r["nag"] is not None:
            args["nagrsquared"] = r["nag"]
        else:
            args["csrsquared"] = r["cs"]
        if kind == "s":
            args.update(rate=r["rate"], timepoint=2, meanfup=r["meanfup"])
        else:
            args.update(prevalence=r["prev"])
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                got = pmsampsize(**args)["sample_size"]
        except ValueError:
            got = None
        expected = None if r.get("error") else r["n"]
        if got != expected:
            bad += 1
            print("MISMATCH", kind, r, got)
from importlib.metadata import version  # noqa: E402
print(f"Python pmsampsize {version('pmsampsize')} vs R {fx['version']}: {total - bad}/{total} match")
sys.exit(1 if bad else 0)
