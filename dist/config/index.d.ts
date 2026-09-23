/**
 * 環境変数を「何を指しているか」で区分して宣言する。
 *
 * 一覧表をドキュメントに書くと、コードの実態から必ず離れていく。
 * ここでは宣言そのものをコードに置き、コードが実際に読んでいる変数と突き合わせて
 * 宣言漏れ・宣言の取り残しをテストで落とす。一覧は describeConfig で毎回生成する。
 * 値は扱わない。describeConfig が返すのも「設定されているか」だけ。
 */
export type VariableKind = 
/** 値そのものが秘密（API キー、秘密鍵）。デプロイ先では置かず、ローカル開発だけで使うのが原則 */
'secret'
/** 秘密の置き場所を指す（SSM パラメータ名、鍵ファイルのパス）。名前自体は秘密ではない */
 | 'secret-ref'
/** 認証・権限の境界（Cognito の issuer / client、AssumeRole 先、GitHub App の ID）。間違えると他人が入れる、見えてはいけない物が見える */
 | 'auth'
/** 課金に効く（モデル ID、予算上限、単価）。間違えても動くので気づきにくい */
 | 'cost'
/** リソースの配線（テーブル名、ARN、リージョン、URL）。多くは IaC が入れる。間違えると動かないので気づける */
 | 'wiring'
/** ローカル開発・ビルドだけで読む（ポート、NODE_ENV、ファイルパス） */
 | 'local';
/** 人が注意を払う順。describeConfig はこの順に並べる。 */
export declare const VARIABLE_KINDS: readonly VariableKind[];
export interface VariableSpec {
    kind: VariableKind;
    /** 何に使うかの一言。区分の理由が名前から読めないときに書く */
    note?: string;
}
export type ConfigSchema = Readonly<Record<string, VariableSpec>>;
/** 宣言を検査してそのまま返す。名前の形と区分の値が不正なら例外。 */
export declare function defineConfig<const T extends ConfigSchema>(schema: T): T;
/**
 * ソースコードの文字列から、環境変数として読まれている名前を拾う。
 *
 * 拾えないもの: 分割代入（`const { A } = process.env`）、変数に入れた名前での参照。
 * そうした読み方をしている変数は宣言漏れを検出できないので、宣言側で持つこと。
 */
export declare function findEnvReferences(source: string): string[];
export interface ConfigDrift {
    /** コードが読んでいるのに宣言されていない */
    undeclared: string[];
    /** 宣言されているのに、どのソースにも名前が現れない */
    unused: string[];
}
/**
 * 宣言とソースの食い違いを返す。
 *
 * unused は「名前が単語としてどこにも現れない」ときだけ数える。
 * `{ parameterVariable: 'X' }` のように文字列で渡している変数や、IaC が環境変数を
 * 設定しているだけの変数を、取り残しと誤判定しないため。
 */
export declare function findConfigDrift(schema: ConfigSchema, sources: readonly string[]): ConfigDrift;
export interface VariableStatus {
    name: string;
    kind: VariableKind;
    note: string | undefined;
    /** 空文字は未設定として扱う */
    set: boolean;
}
type Env = Readonly<Record<string, string | undefined>>;
/** 宣言を注意の順に並べ、それぞれが設定されているかを返す。値は返さない。 */
export declare function describeConfig(schema: ConfigSchema, env?: Env): VariableStatus[];
export {};
