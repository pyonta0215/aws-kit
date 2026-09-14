/**
 * DynamoDB の DocumentClient で毎回書いている定型処理。
 *
 * テーブル設計やリポジトリ層はプロダクトごとに違うので扱わない。
 * ここにあるのは「黙って欠ける」を防ぐための道具だけ。
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, type BatchWriteCommandInput, type QueryCommandInput } from '@aws-sdk/lib-dynamodb';
export interface DocumentClientOptions {
    /** 既存の DynamoDBClient を使うとき（テストのモックなど） */
    client?: DynamoDBClient;
    region?: string;
    /**
     * DynamoDB Local などへ向けるとき。指定するとダミーの認証情報を使う。
     */
    endpoint?: string;
}
/**
 * `removeUndefinedValues: true` の DocumentClient を作る。
 * 省略可能な項目を undefined のまま渡すと、既定では例外になるため。
 */
export declare function createDocumentClient(options?: DocumentClientOptions): DynamoDBDocumentClient;
export interface QueryAllOptions {
    /** この件数に達したらページングをやめ、超えた分は捨てる */
    maxItems?: number;
}
/**
 * `LastEvaluatedKey` が無くなるまで Query を繰り返し、全件を返す。
 *
 * 1回の Query は 1MB で切れる。集計のように「全件」が必要な処理で1ページ目だけを使うと、
 * エラーにならずに結果が静かに欠ける。
 */
export declare function queryAll<T = Record<string, unknown>>(doc: DynamoDBDocumentClient, input: Omit<QueryCommandInput, 'ExclusiveStartKey'>, options?: QueryAllOptions): Promise<T[]>;
export type WriteRequest = NonNullable<BatchWriteCommandInput['RequestItems']>[string][number];
/** BatchWriteItem は1リクエスト25件まで。 */
export declare const BATCH_WRITE_LIMIT = 25;
export declare class UnprocessedItemsError extends Error {
    readonly unprocessed: readonly WriteRequest[];
    constructor(tableName: string, unprocessed: readonly WriteRequest[]);
}
export interface BatchWriteAllOptions {
    /** 1チャンクあたりの最大試行回数（初回を含む）。既定 5。 */
    maxAttempts?: number;
    /** 再試行の待ち時間の基準（ミリ秒）。試行ごとに倍になる。既定 50。 */
    baseDelayMs?: number;
    /** テスト用 */
    sleep?: (ms: number) => Promise<void>;
}
/**
 * 25件ずつに分けて BatchWrite し、`UnprocessedItems` を待ち時間を空けて再試行する。
 *
 * BatchWrite は、スロットリングされた分を例外にせず `UnprocessedItems` で返す。
 * 見ないと成功したように見えて一部が書かれない。再試行しても残れば {@link UnprocessedItemsError}。
 */
export declare function batchWriteAll(doc: DynamoDBDocumentClient, tableName: string, requests: readonly WriteRequest[], options?: BatchWriteAllOptions): Promise<void>;
/** 条件付き書き込み（ConditionExpression）が条件を満たさず失敗したか。 */
export declare function isConditionalCheckFailed(error: unknown): boolean;
