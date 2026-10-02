/** HTTP shutdown works where a sandbox disallows Windows process-tree termination. */
export default async function teardown() {
  const response = await fetch('http://127.0.0.1:4175/__test-shutdown', {
    method: 'POST',
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('The isolated acceptance server could not be closed.');
}
