/**
 * DynamoDB の DocumentClient で毎回書いている定型処理。
 *
 * テーブル設計やリポジトリ層はプロダクトごとに違うので扱わない。
 * ここにあるのは「黙って欠ける」を防ぐための道具だけ。
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, type BatchWriteCommandInput, type QueryCommandInput, type ScanCommandInput } from '@aws-sdk/lib-dynamodb';
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
/**
 * `send` だけを使う。テストで `send` を持つ偽物を渡せるように、クライアント全体を要求しない。
 */
export type DocumentSender = Pick<DynamoDBDocumentClient, 'send'>;
export interface QueryAllOptions {
    /** この件数に達したらページングをやめ、超えた分は捨てる */
    maxItems?: number;
}
/** {@link scanAll} の設定。{@link queryAll} と同じ。 */
export type ScanAllOptions = QueryAllOptions;
/**
 * `LastEvaluatedKey` が無くなるまで Query を繰り返し、全件を返す。
 *
 * 1回の Query は 1MB で切れる。集計のように「全件」が必要な処理で1ページ目だけを使うと、
 * エラーにならずに結果が静かに欠ける。
 */
export declare function queryAll<T = Record<string, unknown>>(doc: DocumentSender, input: Omit<QueryCommandInput, 'ExclusiveStartKey'>, options?: QueryAllOptions): Promise<T[]>;
/**
 * `LastEvaluatedKey` が無くなるまで Scan を繰り返し、全件を返す。
 *
 * Scan も 1MB で切れ、`FilterExpression` は読んだ後に掛かる。1ページ目だけを見ると、
 * 条件に合う項目が2ページ目以降にあっても、空や一部だけの結果がエラーなしに返る。
 * テーブル全体を読むぶん読み込み容量を使うので、件数が増えるなら Query に置き換える。
 */
export declare function scanAll<T = Record<string, unknown>>(doc: DocumentSender, input: Omit<ScanCommandInput, 'ExclusiveStartKey'>, options?: ScanAllOptions): Promise<T[]>;
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
export declare function batchWriteAll(doc: DocumentSender, tableName: string, requests: readonly WriteRequest[], options?: BatchWriteAllOptions): Promise<void>;
/**
 * 条件付き書き込み（ConditionExpression）が条件を満たさず失敗したか。
 * Error のインスタンスに限らず `name` で判定する（SDK のクラスが複数コピーあっても、モックでも同じに扱う）。
 */
export declare function isConditionalCheckFailed(error: unknown): boolean;
