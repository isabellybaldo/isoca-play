"""Text checks on .github/workflows: this repo is public, and its deploy holds the box's key."""

import re
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parents[2] / ".github" / "workflows"
CI = (WORKFLOWS / "ci.yml").read_text()
RELEASE = (WORKFLOWS / "release.yml").read_text()
ALL = {"ci.yml": CI, "release.yml": RELEASE}


def job(text: str, name: str) -> str:
    match = re.search(rf"(?ms)^  {name}:\n(.*?)(?=^  [a-z][a-z0-9_-]*:\n|\Z)", text)
    assert match, name
    return match[1]


def run_bodies(text: str) -> str:
    return "\n".join(re.findall(r"(?m)^ +(?:- )?run: (?:\|\n)?((?:.*\n)*?)(?=^ +(?:- |[a-z-]+:)|\Z)", text))


def test_no_pull_request_target():
    for text in ALL.values():
        assert "pull_request_target" not in text


def test_pull_request_runs_have_no_secret_or_environment():
    assert "secrets." not in CI
    assert "environment:" not in CI
    assert "pull_request" not in RELEASE


def test_every_action_is_pinned_to_a_sha_with_its_version():
    for text in ALL.values():
        for uses in re.findall(r"uses: (\S+.*)", text):
            if not uses.startswith("./"):
                assert re.fullmatch(r"[\w./-]+@[0-9a-f]{40} # v\d[\w.-]*", uses), uses


def test_permissions():
    for text in ALL.values():
        assert "\npermissions:\n  contents: read\n\n" in text
        jobs = re.findall(r"(?m)^  ([a-z][a-z0-9_-]*):$", text.split("\njobs:\n")[1])
        for name in jobs:
            assert "    permissions:\n" in job(text, name), name
    writes = [name for name in ("checks", "publish", "deploy", "rollback") if ": write" in job(RELEASE, name)]
    assert writes == ["publish"]
    assert re.findall(r"(\S+): write", RELEASE) == ["packages"]


def test_deploy_jobs_run_only_from_main():
    deploy = job(RELEASE, "deploy")
    assert (
        "if: github.ref == 'refs/heads/main' && (github.event_name == 'push' "
        "|| github.event_name == 'workflow_dispatch') && !inputs.rollback" in deploy
    )
    assert (
        "if: github.ref == 'refs/heads/main' && github.event_name == 'workflow_dispatch' && inputs.rollback"
        in job(RELEASE, "rollback")
    )


def test_no_expression_inside_a_run_block():
    for text in ALL.values():
        assert "${{" not in run_bodies(text)


def test_ssh_checks_the_pinned_host_key_and_keeps_its_errors_out_of_the_log():
    calls = re.findall(r"out=\$\(ssh [^\n]*", RELEASE)
    assert len(calls) == 2
    for call in calls:
        assert "-o StrictHostKeyChecking=yes -o UserKnownHostsFile=" in call
    assert RELEASE.count('2>"$RUNNER_TEMP/ssh/err")') == 2
    assert 'chmod 600 "$RUNNER_TEMP/ssh/key"' in RELEASE
    assert RELEASE.count('rm -rf "$RUNNER_TEMP/ssh"') == 2
    assert not re.search(r"echo[^\n]*\$\{?DEPLOY_", run_bodies(RELEASE))
    assert "set -x" not in RELEASE


def test_release_sends_only_a_checked_digest_and_the_image_name_is_fixed():
    deploy = job(RELEASE, "deploy")
    assert '[[ "$DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]' in deploy
    assert '"release play $DIGEST"' in deploy
    assert "  IMAGE: ghcr.io/isabellybaldo/isoca-play\n" in RELEASE
    assert ":latest" not in RELEASE


def test_checkout_keeps_no_credentials():
    for text in ALL.values():
        assert text.count("actions/checkout@") == text.count("persist-credentials: false")


def test_rollback_smoke_check_needs_the_version_to_change():
    rollback = job(RELEASE, "rollback")
    assert "BEFORE: ${{ steps.before.outputs.version }}" in rollback
    assert '"$version" != "$BEFORE"' in rollback
    assert rollback.index("Note the version before the rollback") < rollback.index("Roll back on the box")
