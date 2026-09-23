# aws-kit

個人の AWS サーバーレスアプリで繰り返し書いていた処理をまとめた、小さなヘルパー集です。

| サブパス | 中身 |
|---|---|
| `@pyonta0215/aws-kit/cognito` | Cognito アクセストークンの検証（sub 許可リスト、fail-closed） |
| `@pyonta0215/aws-kit/ssm` | SSM SecureString の読み出し（任意の TTL キャッシュ、値をエラーに出さない） |
| `@pyonta0215/aws-kit/cognito/testing` | テスト用のトークン発行（合成鍵） |
| `@pyonta0215/aws-kit/dynamo` | DocumentClient の生成、全件 Query / Scan、25件ずつの BatchWrite と再試行 |
| `@pyonta0215/aws-kit/config` | 環境変数の区分の宣言、コードとの食い違い検出、設定有無の一覧（値は扱わない） |

npm には公開していません。git タグで参照します。

## インストール

```bash
pnpm add github:pyonta0215/aws-kit#v0.4.0
```

AWS SDK と aws-jwt-verify は同梱しません。使うサブパスに応じて、利用側で入れてください（peerDependencies）。

| サブパス | 利用側に必要なもの |
|---|---|
| `cognito` | `aws-jwt-verify`（4.x / 5.x） |
| `ssm` | `@aws-sdk/client-ssm` |
| `dynamo` | `@aws-sdk/client-dynamodb` と `@aws-sdk/lib-dynamodb` |
| `config` | なし |

SDK を利用側の1コピーにそろえるためです。esbuild で SDK を複数のコピーごと1ファイルにまとめると、Lambda の起動時に落ちることがあります。

## 使い方

### cognito

```ts
import {
  createCognitoAccessTokenVerifierFromEnv,
  extractBearerToken,
  httpStatusFor,
} from '@pyonta0215/aws-kit/cognito';

// COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID が無ければ起動時に例外
const verifier = createCognitoAccessTokenVerifierFromEnv(process.env, {
  allowedSubs: 'ALLOWED_USER_SUBS', // 指定した変数が空なら、誰も通さない
});

app.use('/api/*', async (c, next) => {
  const result = await verifier.verify(extractBearerToken(c.req.header('authorization')));
  if (!result.ok) return c.json({ error: result.reason }, httpStatusFor(result.reason));
  c.set('sub', result.sub);
  await next();
});
```

- 失敗は例外でなく `{ ok: false, reason }` で返します。`missing` と `invalid` は 401、`forbidden` は 403 です。
- 独自ヘッダでトークンを送る場合は、`extractBearerToken` を使わずにヘッダの値をそのまま `verify` へ渡します。
- ローカル開発で認証を外す仕組みは、あえて入れていません。環境変数ひとつで認証が外れる経路を、共有コードに持たせないためです。

### ssm

```ts
import { createSsmSecureParameterReader, requireSecret } from '@pyonta0215/aws-kit/ssm';

const reader = createSsmSecureParameterReader({ cacheTtlMs: 5 * 60_000 });

// ANTHROPIC_API_KEY_PARAMETER があれば SSM から、無ければ ANTHROPIC_API_KEY から
const apiKey = await requireSecret(
  { parameterVariable: 'ANTHROPIC_API_KEY_PARAMETER', valueVariable: 'ANTHROPIC_API_KEY' },
  process.env,
  reader,
);
```

読み出しの失敗は `SecureParameterError` で、`kind`（`request-failed` / `empty` / `invalid-name` / `no-reader`）で種類を判定できます。値や SDK のメッセージはエラーに含めません。

### dynamo

```ts
import { batchWriteAll, createDocumentClient, queryAll, scanAll } from '@pyonta0215/aws-kit/dynamo';

const doc = createDocumentClient();

const items = await queryAll(doc, {
  TableName: 'app',
  KeyConditionExpression: 'pk = :pk',
  ExpressionAttributeValues: { ':pk': 'SNAPSHOT' },
});

// FilterExpression は読んだ後に掛かるので、1ページ目が空でも続きを読む
const runs = await scanAll(doc, {
  TableName: 'app',
  FilterExpression: 'entityType = :t',
  ExpressionAttributeValues: { ':t': 'Run' },
});

await batchWriteAll(doc, 'app', items.map((Item) => ({ PutRequest: { Item } })));
```

`queryAll` / `scanAll` / `batchWriteAll` は `send` を持つオブジェクトなら受け取ります（テストで偽物を渡せます）。

`queryAll` / `scanAll` は `LastEvaluatedKey` が無くなるまで読みます（1回の Query / Scan は 1MB で切れ、1ページ目だけでは結果が黙って欠けるため）。`maxItems` を渡すと、その件数に達した時点で読むのをやめます。途中のページで失敗したときは、読めた分を返さずに例外を投げます。

`batchWriteAll` は `UnprocessedItems` を待ち時間を空けて再試行し、それでも残れば `UnprocessedItemsError` を投げます。

### config

環境変数を「何を指しているか」で区分して、コードの中で宣言します。一覧表をドキュメントに書く代わりに、宣言とコードの食い違いをテストで落とします。

```ts
import { defineConfig, describeConfig, findConfigDrift } from '@pyonta0215/aws-kit/config';

export const config = defineConfig({
  OPENAI_API_KEY_PARAMETER: { kind: 'secret-ref' },
  COGNITO_CLIENT_ID: { kind: 'auth' },
  LLM_MODEL_ID: { kind: 'cost' },
  TABLE_NAME: { kind: 'wiring', note: 'CDK が設定する' },
});

// テスト: ソースの中身を渡すと、宣言漏れ（undeclared）と取り残し（unused）を返す
expect(findConfigDrift(config, sources)).toEqual({ undeclared: [], unused: [] });

// 注意の順（secret → secret-ref → auth → cost → wiring → local）に、設定の有無だけを返す
describeConfig(config, process.env);
```

| kind | 指しているもの | 間違えたとき |
|---|---|---|
| `secret` | 値そのものが秘密（API キー） | 漏れると被害が出る。デプロイ先には置かない |
| `secret-ref` | 秘密の置き場所（SSM パラメータ名、鍵ファイルのパス） | 読めずに止まる |
| `auth` | 認証・権限の境界（Cognito、AssumeRole 先） | 他人が入れる、見えてはいけない物が見える |
| `cost` | 課金に効く値（モデル、予算、単価） | 動くので気づきにくい |
| `wiring` | リソースの配線（テーブル名、ARN、リージョン） | 動かないので気づける |
| `local` | ローカル開発・ビルドだけ | 本番に影響しない |

`findEnvReferences` が拾うのは `process.env.X` / `import.meta.env.X` / `env.X` / `environment.X` と、それぞれの `['X']` 形です。分割代入や、変数に入れた名前での参照は拾えません。

### cognito/testing（テスト専用）

合成した RSA 鍵でアクセストークンを発行します。JWKS を取りに行かずに、本物の署名検証の経路を通したテストが書けます。

```ts
import { createCognitoAccessTokenVerifierFromEnv } from '@pyonta0215/aws-kit/cognito';
import { createTestTokenIssuer } from '@pyonta0215/aws-kit/cognito/testing';

const issuer = createTestTokenIssuer({ userPoolId: 'us-east-1_Example1', clientId: 'exampleclient' });
const env = { COGNITO_USER_POOL_ID: 'us-east-1_Example1', COGNITO_CLIENT_ID: 'exampleclient' };
const verifier = createCognitoAccessTokenVerifierFromEnv(env, {}, { jwks: issuer.jwks });

await verifier.verify(issuer.accessToken({ sub: 'me' }));        // ok
await verifier.verify(issuer.accessToken({ token_use: 'id' }));  // invalid
```

## ここに入れるものの条件

1. 3つ以上のリポジトリで、同じ処理が実際に書かれている
2. 特定のドメイン・アカウント・メールアドレス・プロダクト名を含まない
3. 合成データだけでテストできる（実在のトークン・ID・レコードを使わない）

プロダクト固有の設定や許可ポリシーは、それぞれのリポジトリに置きます。

## 開発

```bash
npm ci
npm run check   # typecheck → test → build → dist に差分が無いことを確認
```

`dist/` はコミットします。git タグで参照したとき、利用側でビルドを走らせずに使えるようにするためです。

## リリース

```bash
npm version <patch|minor> --no-git-tag-version
npm run check
git commit -am "release: vX.Y.Z" && git tag vX.Y.Z && git push --follow-tags
```

破壊的な変更は minor を上げます（1.0.0 までは minor を破壊的変更の区切りとして扱います）。

## License

MIT
