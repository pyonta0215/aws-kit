import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  batchWriteAll,
  createDocumentClient,
  isConditionalCheckFailed,
  queryAll,
  UnprocessedItemsError,
  type WriteRequest,
} from './index.js';

const ddb = mockClient(DynamoDBDocumentClient);
const doc = createDocumentClient({ client: new DynamoDBClient({ region: 'us-east-1' }) });
const noSleep = async () => {};

beforeEach(() => ddb.reset());

const put = (n: number): WriteRequest => ({ PutRequest: { Item: { pk: 'P', sk: String(n) } } });

describe('createDocumentClient', () => {
  it('undefined の項目を捨てて書ける', async () => {
    ddb.on(PutCommand).resolves({});
    await doc.send(new PutCommand({ TableName: 't', Item: { pk: 'a', optional: undefined } }));
    expect(doc.config.translateConfig?.marshallOptions?.removeUndefinedValues).toBe(true);
  });
});

describe('queryAll', () => {
  it('LastEvaluatedKey が無くなるまで読む', async () => {
    ddb
      .on(QueryCommand)
      .resolvesOnce({ Items: [{ n: 1 }, { n: 2 }], LastEvaluatedKey: { pk: 'P', sk: '2' } })
      .resolvesOnce({ Items: [{ n: 3 }] });
    const items = await queryAll(doc, { TableName: 't', KeyConditionExpression: 'pk = :pk', ExpressionAttributeValues: { ':pk': 'P' } });
    expect(items).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    const calls = ddb.commandCalls(QueryCommand);
    expect(calls[0]?.args[0].input.ExclusiveStartKey).toBeUndefined();
    expect(calls[1]?.args[0].input.ExclusiveStartKey).toEqual({ pk: 'P', sk: '2' });
  });

  it('maxItems に達したらやめて切り詰める', async () => {
    ddb
      .on(QueryCommand)
      .resolvesOnce({ Items: [{ n: 1 }, { n: 2 }], LastEvaluatedKey: { k: 1 } })
      .resolvesOnce({ Items: [{ n: 3 }, { n: 4 }], LastEvaluatedKey: { k: 2 } })
      .resolves({ Items: [{ n: 5 }] });
    const items = await queryAll(doc, { TableName: 't' }, { maxItems: 3 });
    expect(items).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    expect(ddb.commandCalls(QueryCommand)).toHaveLength(2);
  });
});

describe('batchWriteAll', () => {
  it('25件ずつに分ける', async () => {
    ddb.on(BatchWriteCommand).resolves({});
    await batchWriteAll(doc, 't', Array.from({ length: 51 }, (_, i) => put(i)), { sleep: noSleep });
    const sizes = ddb.commandCalls(BatchWriteCommand).map((c) => c.args[0].input.RequestItems?.t?.length);
    expect(sizes).toEqual([25, 25, 1]);
  });

  it('UnprocessedItems を待ってから再試行する', async () => {
    const delays: number[] = [];
    ddb
      .on(BatchWriteCommand)
      .resolvesOnce({ UnprocessedItems: { t: [put(2)] } })
      .resolvesOnce({ UnprocessedItems: { t: [put(2)] } })
      .resolves({});
    await batchWriteAll(doc, 't', [put(1), put(2)], { sleep: async (ms) => void delays.push(ms) });
    const calls = ddb.commandCalls(BatchWriteCommand);
    expect(calls).toHaveLength(3);
    expect(calls[2]?.args[0].input.RequestItems?.t).toEqual([put(2)]);
    expect(delays).toEqual([50, 100]);
  });

  it('再試行しても残れば UnprocessedItemsError', async () => {
    ddb.on(BatchWriteCommand).resolves({ UnprocessedItems: { t: [put(1)] } });
    const error = await batchWriteAll(doc, 't', [put(1)], { maxAttempts: 3, sleep: noSleep }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnprocessedItemsError);
    expect((error as UnprocessedItemsError).unprocessed).toEqual([put(1)]);
    expect(ddb.commandCalls(BatchWriteCommand)).toHaveLength(3);
  });

  it('空なら何もしない', async () => {
    await batchWriteAll(doc, 't', []);
    expect(ddb.commandCalls(BatchWriteCommand)).toHaveLength(0);
  });
});

describe('isConditionalCheckFailed', () => {
  it('例外名で判定する', () => {
    expect(isConditionalCheckFailed(Object.assign(new Error('x'), { name: 'ConditionalCheckFailedException' }))).toBe(true);
    expect(isConditionalCheckFailed(new Error('x'))).toBe(false);
    expect(isConditionalCheckFailed('ConditionalCheckFailedException')).toBe(false);
  });
});
