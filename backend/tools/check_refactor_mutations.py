"""Prove representative regressions are detected in disposable source copies.

Run with the same Python environment as backend/tests. Production files are never
modified. A nonzero status means a mutant survived or verification did not run.
"""
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory

BACKEND = Path(__file__).resolve().parents[1]
MUTATIONS = (
    ('consent_revision', 'app/services/recording_guard.py',
     'if recording_revision(user_id) != expected_revision:', 'if False:',
     'tests/test_recording_and_sync.py::test_recording_guard_rechecks_consent_and_revision'),
    ('account_ownership', 'app/services/authentication.py',
     "if requested_user_id and requested_user_id != requester['id']:", 'if False:',
     'tests/test_authentication.py::test_linked_target_selection_and_revocation'),
    ('request_idempotency', 'app/services/communication.py',
     "if existing:\n            if (existing['cards']", "if False:\n            if (existing['cards']",
     'tests/test_communication.py::test_generation_fallback_order_selection_times_and_idempotency'),
)


def main():
    for name, relative_path, original, replacement, test in MUTATIONS:
        with TemporaryDirectory(prefix='pecsmate-mutation-') as directory:
            root = Path(directory)
            for folder in ('app', 'tests'):
                shutil.copytree(BACKEND / folder, root / folder, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
            shutil.copyfile(BACKEND / 'pytest.ini', root / 'pytest.ini')
            target = root / relative_path
            source = target.read_text(encoding='utf-8')
            if source.count(original) != 1:
                raise RuntimeError(f'{name}: mutation seam is no longer unique')
            target.write_text(source.replace(original, replacement, 1), encoding='utf-8')
            result = subprocess.run([sys.executable, '-m', 'pytest', test, '-q', '--tb=no'],
                                    cwd=root, capture_output=True, text=True, timeout=45)
            detected = result.returncode == 1 and 'FAILED' in result.stdout
            # Exit code 1 is pytest's assertion failure, not collection/import errors.
            if not detected:
                sys.stderr.write(result.stdout + result.stderr)
                raise RuntimeError(f'{name}: mutant survived or tests did not execute')
            print(f'{name}: detected by {test}', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
