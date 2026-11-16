/* サンプルプログラム（C ソース）
 *   expect: 停止時の変数の期待値（テスト用）
 *   viz:    数学ビューの描き方
 *   tm:     false なら重いので TM 層を最初は省略する（画面で ON にもできる）
 *   group:  メニューの見出し */
(function (root) {
const PROGRAMS = [
  { id: 'add', group: '入門', name: '足し算 2 + 3（1 ずつ）', expect: { a: 5, b: 0 }, viz: { type: 'series' }, src:
`// 足し算: a ← a + b を 1 ずつ数えて
unsigned int a = 2;
unsigned int b = 3;

void main(void) {
    while (b) {      // b が 0 になるまで
        b--;
        a++;
    }
}
` },
  { id: 'parity', group: '入門', name: '偶奇判定 5 mod 2（if / else）', expect: { a: 0, d: 1 }, viz: { type: 'series' }, src:
`// d ← a mod 2（偶数なら 0、奇数なら 1）
unsigned int a = 5, d = 0;

void main(void) {
    while (a) {
        a--;
        if (d) d--;
        else   d++;
    }
}
` },
  { id: 'wrap', group: '入門', name: '16bit の桁あふれ 65530 + 9', expect: { a: 3 }, viz: { type: 'series' }, src:
`// unsigned int（16bit）は 65536 で一周する（C = 1 になる）
unsigned int a = 65530, b = 9;

void main(void) {
    a += b;          // 65539 mod 65536 = 3
}
` },
  { id: 'mulop', group: '入門', name: '掛け算と割り算 123 × 45 ÷ 7', expect: { p: 5535, q: 790, r: 5 }, viz: { type: 'series' }, src:
`// 演算子 * / % はコンパイラがループに展開する
//   *   → シフトと足し算（T-MUL）
//   / % → 筆算の割り算 16 桁（T-DIV）
unsigned int a = 123, b = 45, p, q, r;

void main(void) {
    p = a * b;       // 5535
    q = p / 7;       // 790
    r = p % 7;       // 5
}
` },
  { id: 'newton', group: '数値計算', name: 'ニュートン法 √2 ≈ x/100', expect: { x: 141 }, viz: { type: 'newton', N: 'N', x: 'x', scale: 100 }, src:
`// ニュートン法: f(x) = x² − N の零点 √N を求める
//   x ← x − f(x)/f'(x) = (x + N/x) / 2
//   N = 20000 = 2 × 100² なので √N = 100·√2 → x/100 ≈ √2
unsigned int N = 20000, x = 20000, y;

void main(void) {
    while (1) {
        y = N / x;           // 割り算（16 桁の筆算ループ）
        y = y + x;
        y >>= 1;             // y = (x + N/x) / 2
        if (y >= x) break;   // 減らなくなった → 収束
        x = y;
    }
}
` },
  { id: 'euler', group: '数値計算', name: 'オイラー法 dy/dt = −y/8', expect: { y: 56, n: 0 }, viz: { type: 'ode', y: 'y', t: { n: 'n', n0: 10, dt: 1 }, exact: 'decay', y0: 200, k: 1 / 8, real: 'eulerDecay', title: 'dy/dt = −y/8' }, src:
`// オイラー法: dy/dt = −y/8 を Δt = 1 で 10 歩
//   y ← y + Δt·(−y/8) = y − (y >> 3)
//   厳密解 y(10) = 200·e^(−1.25) ≈ 57.3
//   実数のオイラー法 200·(7/8)^10 ≈ 52.6、整数の切り捨てで 56
unsigned int y = 200, n = 10, t;

void main(void) {
    while (n) {
        t = y >> 3;         // t = y / 8
        y -= t;
        n--;
    }
}
` },
  { id: 'logistic', group: '数値計算', name: 'オイラー法 ロジスティック方程式', expect: { y: 192, n: 0 }, viz: { type: 'ode', y: 'y', t: { n: 'n', n0: 24, dt: 0.25 }, exact: 'logistic', y0: 5, K: 250, r: 1, title: 'dy/dt = y(1 − y/K)' }, src:
`// オイラー法: ロジスティック方程式 dy/dt = r·y·(1 − y/K)
//   r = 1, K = 250, Δt = 1/4 で 24 歩（t = 0 → 6）
//   y ← y + Δt · y·(K − y)/K = y + y·(K − y) / (4K)
//   S 字に増えて K = 250 に近づく。y(6): 厳密解 222.9 / 実数のオイラー法 217.2
//   整数で計算すると切り捨てのぶん遅れて 192（小さい y ほど誤差が大きい）
unsigned int y = 5, K = 250, n = 24, t, u = 1000;   // u = 4K

void main(void) {
    while (n) {
        t = K - y;
        t = y * t;          // y·(K − y)  ≤ 15625
        t = t / u;          // ÷ 4K（Δt = 1/4 をまとめて割る）
        y += t;
        n--;
    }
}
` },
  { id: 'fall', group: '数値計算', name: 'オイラー法 自由落下 x″ = g', expect: { x: 90, v: 20 }, viz: { type: 'ode', y: 'x', t: { n: 'n', n0: 10, dt: 1 }, exact: 'fall', g: 2, real: 'eulerFall', title: 'x″ = g（g = 2）' }, src:
`// オイラー法で自由落下: dv/dt = g, dx/dt = v（Δt = 1, g = 2）
//   x ← x + v·Δt,  v ← v + g·Δt を 10 歩
//   オイラー法 x(10) = 90、厳密解 g·t²/2 = 100
unsigned int x = 0, v = 0, g = 2, n = 10;

void main(void) {
    while (n) {
        x += v;             // 位置を古い速度で進める
        v += g;
        n--;
    }
}
` },
  { id: 'gcd', group: '数論', name: 'ユークリッドの互除法 gcd(1071, 462)', expect: { a: 21, b: 0 }, viz: { type: 'gcd', a: 'a', b: 'b' }, src:
`// ユークリッドの互除法: gcd(a, b) = gcd(b, a mod b)
//   b が 0 になったときの a が最大公約数（答え 21）
unsigned int a = 1071, b = 462, t;

void main(void) {
    while (b) {
        t = a % b;
        a = b;
        b = t;
    }
}
` },
  { id: 'fib', group: '数論', name: 'フィボナッチ数 F(24) と黄金比', expect: { a: 28657, b: 46368, n: 0 }, viz: { type: 'fib', a: 'a', b: 'b' }, src:
`// フィボナッチ数: F(k+1) = F(k) + F(k−1)
//   n 回まわすと b = F(n+1)。F(24) = 46368（16bit に収まる最大級）
//   b / a は黄金比 φ = 1.618… に近づく
unsigned int n = 23, a = 0, b = 1, t;

void main(void) {
    while (n) {
        t = a + b;
        a = b;
        b = t;
        n--;
    }
}
` },
  { id: 'collatz', group: '数論', name: 'コラッツの問題 n = 27（関数）', expect: { n: 1, steps: 111, peak: 9232 }, viz: { type: 'series', vars: ['n'], log: true, title: 'コラッツ数列（縦軸は対数）' }, src:
`// コラッツの問題: 偶数なら n/2、奇数なら 3n+1。1 になるまで続ける
//   n = 27 は 111 歩かかり、途中で 9232 まで上がる
unsigned int n = 27, steps = 0, peak = 27, h;

void next(void) {          // 1 歩進める（大域変数 n を書き換える）
    h = n >> 1;
    h <<= 1;               // h = n の最下位ビットを 0 にしたもの
    if (h == n) {
        n >>= 1;           // 偶数 → n / 2
    } else {
        h = n + n;
        n = h + n;
        n++;               // 奇数 → 3n + 1
    }
}

void main(void) {
    while (n != 1) {
        next();
        steps++;
        if (n > peak) peak = n;
    }
}
` },
  { id: 'factor', group: '数論', name: '素因数分解 360（配列）', expect: { n: 1, k: 6 }, viz: { type: 'factor', arr: 'f', k: 'k', n: 'n', d: 'd', n0: 360 }, src:
`// 素因数分解: 小さい数から割れるだけ割る
//   360 = 2·2·2·3·3·5 → 因数を配列 f に並べる
unsigned int f[12];
unsigned int n = 360, d = 2, k = 0, r;

void main(void) {
    while (n > 1) {
        r = n % d;
        if (r == 0) {
            f[k] = d;
            k++;
            n = n / d;
        } else {
            d++;
        }
    }
}
` },
  { id: 'sieve', group: '配列', name: 'エラトステネスの篩（60 未満の素数）', expect: { c: 17 }, viz: { type: 'sieve', arr: 'p', i: 'i', j: 'j', N: 60 }, src:
`// エラトステネスの篩: p[k] = 1 なら k は合成数
//   素数 i を見つけたら i·i, i·i+i, … に印を付ける
unsigned int p[60];
unsigned int N = 60, i, j, c, x;

void main(void) {
    for (i = 2; i < N; i++) {
        x = p[i];
        if (x == 0) {          // 印が無い → 素数
            c++;
            j = i * i;
            while (j < N) {
                p[j] = 1;
                j += i;
            }
        }
    }
}
` },
  { id: 'sort', group: '配列', name: 'バブルソート（10 個）', expect: { i: 0 }, viz: { type: 'array', arr: 'v', idx: ['j', 'k'], mark: 'i' }, src:
`// バブルソート: 隣どうしを比べ、大きいほうを後ろへ送る
//   1 周ごとに一番大きい数が右端に決まる
unsigned int v[10] = {53, 7, 91, 24, 68, 3, 45, 80, 16, 37};
unsigned int n = 10, i, j, k, x, y;

void main(void) {
    for (i = n - 1; i > 0; i--) {
        for (j = 0; j < i; j++) {
            k = j + 1;
            x = v[j];
            y = v[k];
            if (x > y) {        // 逆順なら入れ替える
                v[j] = y;
                v[k] = x;
            }
        }
    }
}
` },
];
if (typeof module !== 'undefined' && module.exports) module.exports = PROGRAMS;
root.CPU5_PROGRAMS = PROGRAMS;
})(typeof window !== 'undefined' ? window : globalThis);
