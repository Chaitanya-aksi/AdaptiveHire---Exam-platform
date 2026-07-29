import { autoSubmitJobId } from './auto-submit/auto-submit.job';
import { reportJobId } from './report-generation/report-generation.job';

/**
 * BullMQ throws "Custom Id cannot contain :" at `queue.add` time, and both
 * producers catch their own enqueue failures so as not to break a candidate's
 * submission — which means a bad id here fails completely silently, and the
 * job simply never runs. Guard it.
 */
describe('custom queue job ids', () => {
  const SESSION_ID = '3f6b1a2c-9d4e-4f80-8a11-0c2d5e7b9a13';

  it.each([
    ['auto-submit', autoSubmitJobId(SESSION_ID)],
    ['report-generation', reportJobId(SESSION_ID)],
  ])('%s job id contains no colon', (_queue, jobId) => {
    expect(jobId).not.toContain(':');
  });

  it.each([
    ['auto-submit', autoSubmitJobId],
    ['report-generation', reportJobId],
  ])('%s job id is unique per session', (_queue, build) => {
    expect(build(SESSION_ID)).not.toBe(
      build('00000000-0000-4000-8000-000000000000'),
    );
    expect(build(SESSION_ID)).toContain(SESSION_ID);
  });
});
