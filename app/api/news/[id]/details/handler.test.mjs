import test from 'node:test';
import assert from 'node:assert/strict';
import { detailsResponse } from './handler.mjs';
import { queueReportDetails } from '../../../../../lib/newsReports/storage.mjs';

test('retired details endpoint never queues research or audio', async () => {
  const response = detailsResponse();
  assert.equal(response.status, 410);
  assert.equal((await response.json()).code, 'NEWS_DETAILS_RETIRED');
  await assert.rejects(queueReportDetails(), { code: 'NEWS_DETAILS_RETIRED', httpStatus: 410 });
});
