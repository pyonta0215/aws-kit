/**
 * Cognito User Pool が発行したアクセストークンを検証する。
 *
 * 署名・issuer・期限・`token_use=access`・Client ID の検証は aws-jwt-verify に任せ、
 * 自前で JWT を扱わない。このモジュールが足すのは次の3つだけ。
 *
 * - 失敗を例外でなく値で返す（401 と 403 を呼び出し側で分けられるように）
 * - sub の許可リスト。User Pool を複数プロダクトで共有していると、
 *   「検証が通った」は「このプロダクトを使ってよい」を意味しない
 * - 設定漏れで黙って開かない（fail-closed）
 */
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { Jwks } from 'aws-jwt-verify/jwk';

export type AccessTokenFailure =
  /** トークンが渡されていない */
  | 'missing'
  /** 署名・期限・issuer・Client ID・token_use のどれかが合わない */
  | 'invalid'
  /** 検証は通ったが、許可リストに sub が無い */
  | 'forbidden';

export type AccessTokenResult =
  | {
      ok: true;
      sub: string;
      /** Cognito のアクセストークンが持つ `username`。無ければ undefined。 */
      username: string | undefined;
      claims: Readonly<Record<string, unknown>>;
    }
  | { ok: false; reason: AccessTokenFailure };

export interface AccessTokenVerifier {
  verify(token: string | null | undefined): Promise<AccessTokenResult>;
}

export interface CognitoAccessTokenVerifierOptions {
  userPoolId: string;
  /** プロダクト専用の App Client ID。複数を受け付けるときは配列で渡す。 */
  clientId: string | readonly string[];
  /**
   * 通してよい sub。**渡した場合、空なら誰も通さない。**
   * 渡さなければ sub では絞らない（User Pool 側で利用者を制限している前提）。
   */
  allowedSubs?: Iterable<string>;
  /**
   * JWKS を取得せずに使う鍵。テストで合成した鍵を渡すためのもので、本番では渡さない。
   */
  jwks?: Jwks;
}

export function createCognitoAccessTokenVerifier(
  options: CognitoAccessTokenVerifierOptions,
): AccessTokenVerifier {
  const clientIds = typeof options.clientId === 'string' ? [options.clientId] : [...options.clientId];
  if (options.userPoolId.trim() === '' || clientIds.length === 0 || clientIds.some((id) => id.trim() === '')) {
    throw new Error('userPoolId と clientId は空にできません');
  }

  const verifier = CognitoJwtVerifier.create({
    userPoolId: options.userPoolId,
    tokenUse: 'access',
    clientId: clientIds,
  });
  if (options.jwks) verifier.cacheJwks(options.jwks);

  const allowed = options.allowedSubs === undefined ? undefined : new Set(options.allowedSubs);

  return {
    async verify(token) {
      const raw = token?.trim() ?? '';
      if (raw === '') return { ok: false, reason: 'missing' };

      let claims: Record<string, unknown>;
      try {
        claims = (await verifier.verify(raw)) as unknown as Record<string, unknown>;
      } catch {
        // 理由（期限切れ・別プール・署名不一致など）はクライアントへ返さない。
        return { ok: false, reason: 'invalid' };
      }

      const sub = claims.sub;
      if (typeof sub !== 'string' || sub === '') return { ok: false, reason: 'invalid' };
      if (allowed !== undefined && !allowed.has(sub)) return { ok: false, reason: 'forbidden' };

      const username = typeof claims.username === 'string' ? claims.username : undefined;
      return { ok: true, sub, username, claims };
    },
  };
}

export interface CognitoEnvNames {
  userPoolId?: string;
  clientId?: string;
  /**
   * 許可リストを読む環境変数名。指定した場合、その変数が未設定・空なら誰も通さない。
   */
  allowedSubs?: string;
}

/**
 * 環境変数から検証器を作る。User Pool ID か Client ID が無ければ例外を投げる。
 * 設定漏れを「認証なしで動く」に倒さず、起動時に落とすため。
 */
export function createCognitoAccessTokenVerifierFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  names: CognitoEnvNames = {},
  extra: Pick<CognitoAccessTokenVerifierOptions, 'jwks'> = {},
): AccessTokenVerifier {
  const poolVar = names.userPoolId ?? 'COGNITO_USER_POOL_ID';
  const clientVar = names.clientId ?? 'COGNITO_CLIENT_ID';
  const userPoolId = env[poolVar]?.trim();
  const clientId = env[clientVar]?.trim();
  if (!userPoolId || !clientId) {
    throw new Error(`${poolVar} と ${clientVar} が必要です`);
  }
  return createCognitoAccessTokenVerifier({
    userPoolId,
    clientId,
    ...(names.allowedSubs === undefined ? {} : { allowedSubs: parseAllowedSubs(env[names.allowedSubs]) }),
    ...extra,
  });
}

/** `sub-a, sub-b` のようなカンマ区切りを集合にする。空要素は捨てる。 */
export function parseAllowedSubs(raw: string | undefined): ReadonlySet<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== ''),
  );
}

/** `Authorization: Bearer <token>` からトークンを取り出す。形式が違えば null。 */
export function extractBearerToken(header: string | null | undefined): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  return match?.[1] ?? null;
}

/** 失敗理由を HTTP ステータスへ。認証できないものは 401、権限が無いものは 403。 */
export function httpStatusFor(reason: AccessTokenFailure): 401 | 403 {
  return reason === 'forbidden' ? 403 : 401;
}
