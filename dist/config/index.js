/**
 * 環境変数を「何を指しているか」で区分して宣言する。
 *
 * 一覧表をドキュメントに書くと、コードの実態から必ず離れていく。
 * ここでは宣言そのものをコードに置き、コードが実際に読んでいる変数と突き合わせて
 * 宣言漏れ・宣言の取り残しをテストで落とす。一覧は describeConfig で毎回生成する。
 * 値は扱わない。describeConfig が返すのも「設定されているか」だけ。
 */
/** 人が注意を払う順。describeConfig はこの順に並べる。 */
export const VARIABLE_KINDS = ['secret', 'secret-ref', 'auth', 'cost', 'wiring', 'local'];
const VARIABLE_NAME = /^[A-Z][A-Z0-9_]*$/;
/** 宣言を検査してそのまま返す。名前の形と区分の値が不正なら例外。 */
export function defineConfig(schema) {
    for (const [name, spec] of Object.entries(schema)) {
        if (!VARIABLE_NAME.test(name))
            throw new Error(`環境変数名として不正です: ${name}`);
        if (!VARIABLE_KINDS.includes(spec.kind))
            throw new Error(`${name} の kind が不正です: ${String(spec.kind)}`);
    }
    return schema;
}
// process.env.X / import.meta.env.X / env.X / environment.X と、それぞれの ['X'] 形
const ENV_REFERENCE = /\b(?:process\.env|import\.meta\.env|env|environment)\s*(?:\.\s*([A-Z][A-Z0-9_]*)\b|\[\s*(['"`])([A-Z][A-Z0-9_]*)\2\s*\])/g;
/**
 * ソースコードの文字列から、環境変数として読まれている名前を拾う。
 *
 * 拾えないもの: 分割代入（`const { A } = process.env`）、変数に入れた名前での参照。
 * そうした読み方をしている変数は宣言漏れを検出できないので、宣言側で持つこと。
 */
export function findEnvReferences(source) {
    const names = new Set();
    for (const match of source.matchAll(ENV_REFERENCE)) {
        const name = match[1] ?? match[3];
        if (name)
            names.add(name);
    }
    return [...names].sort();
}
/**
 * 宣言とソースの食い違いを返す。
 *
 * unused は「名前が単語としてどこにも現れない」ときだけ数える。
 * `{ parameterVariable: 'X' }` のように文字列で渡している変数や、IaC が環境変数を
 * 設定しているだけの変数を、取り残しと誤判定しないため。
 */
export function findConfigDrift(schema, sources) {
    const declared = new Set(Object.keys(schema));
    const referenced = new Set(sources.flatMap(findEnvReferences));
    const joined = sources.join('\n');
    return {
        undeclared: [...referenced].filter((name) => !declared.has(name)).sort(),
        unused: [...declared].filter((name) => !new RegExp(`\\b${name}\\b`).test(joined)).sort(),
    };
}
/** 宣言を注意の順に並べ、それぞれが設定されているかを返す。値は返さない。 */
export function describeConfig(schema, env = {}) {
    return Object.entries(schema)
        .map(([name, spec]) => ({ name, kind: spec.kind, note: spec.note, set: (env[name] ?? '') !== '' }))
        .sort((a, b) => VARIABLE_KINDS.indexOf(a.kind) - VARIABLE_KINDS.indexOf(b.kind) || a.name.localeCompare(b.name));
}
