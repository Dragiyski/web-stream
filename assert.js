export let assert = null;

if (process?.env?.ASSERT) {
    assert = (await import('node:assert')).default;
}
