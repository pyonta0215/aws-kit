/**
 * DynamoDB の DocumentClient で毎回書いている定型処理。
 *
 * テーブル設計やリポジトリ層はプロダクトごとに違うので扱わない。
 * ここにあるのは「黙って欠ける」を防ぐための道具だけ。
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient, QueryCommand, } from '@aws-sdk/lib-dynamodb';
/**
 * `removeUndefinedValues: true` の DocumentClient を作る。
 * 省略可能な項目を undefined のまま渡すと、既定では例外になるため。
 */
export function createDocumentClient(options = {}) {
    const base = options.client ??
        new DynamoDBClient({
            ...(options.region ? { region: options.region } : {}),
            ...(options.endpoint
                ? { endpoint: options.endpoint, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }
                : {}),
        });
    return DynamoDBDocumentClient.from(base, { marshallOptions: { removeUndefinedValues: true } });
}
/**
 * `LastEvaluatedKey` が無くなるまで Query を繰り返し、全件を返す。
 *
 * 1回の Query は 1MB で切れる。集計のように「全件」が必要な処理で1ページ目だけを使うと、
 * エラーにならずに結果が静かに欠ける。
 */
export async function queryAll(doc, input, options = {}) {
    const items = [];
    let startKey;
    do {
        const result = await doc.send(new QueryCommand({ ...input, ...(startKey ? { ExclusiveStartKey: startKey } : {}) }));
        items.push(...(result.Items ?? []));
        startKey = result.LastEvaluatedKey;
    } while (startKey && (options.maxItems === undefined || items.length < options.maxItems));
    return options.maxItems === undefined ? items : items.slice(0, options.maxItems);
}
/** BatchWriteItem は1リクエスト25件まで。 */
export const BATCH_WRITE_LIMIT = 25;
export class UnprocessedItemsError extends Error {
    unprocessed;
    constructor(tableName, unprocessed) {
        super(`${tableName} への書き込みのうち ${unprocessed.length} 件が、再試行しても処理されませんでした`);
        this.name = 'UnprocessedItemsError';
        this.unprocessed = unprocessed;
    }
}
/**
 * 25件ずつに分けて BatchWrite し、`UnprocessedItems` を待ち時間を空けて再試行する。
 *
 * BatchWrite は、スロットリングされた分を例外にせず `UnprocessedItems` で返す。
 * 見ないと成功したように見えて一部が書かれない。再試行しても残れば {@link UnprocessedItemsError}。
 */
export async function batchWriteAll(doc, tableName, requests, options = {}) {
    const maxAttempts = options.maxAttempts ?? 5;
    const baseDelayMs = options.baseDelayMs ?? 50;
    const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    for (let i = 0; i < requests.length; i += BATCH_WRITE_LIMIT) {
        let pending = requests.slice(i, i + BATCH_WRITE_LIMIT);
        for (let attempt = 1; pending.length > 0; attempt++) {
            if (attempt > maxAttempts)
                throw new UnprocessedItemsError(tableName, pending);
            if (attempt > 1)
                await sleep(baseDelayMs * 2 ** (attempt - 2));
            const result = await doc.send(new BatchWriteCommand({ RequestItems: { [tableName]: pending } }));
            pending = result.UnprocessedItems?.[tableName] ?? [];
        }
    }
}
/**
 * 条件付き書き込み（ConditionExpression）が条件を満たさず失敗したか。
 * Error のインスタンスに限らず `name` で判定する（SDK のクラスが複数コピーあっても、モックでも同じに扱う）。
 */
export function isConditionalCheckFailed(error) {
    return (typeof error === 'object' &&
        error !== null &&
        error.name === 'ConditionalCheckFailedException');
}
