/* サンプルプログラム（C ソース）。expect は停止時の変数の期待値（テスト用） */
(function (root) {
const PROGRAMS = [
  { id: 'add', name: '足し算 2 + 3（1 ずつ）', expect: { a: 5, b: 0 }, src:
`// 足し算: a ← a + b を 1 ずつ数えて
unsigned char a = 2;
unsigned char b = 3;

void main(void) {
    while (b) {      // b が 0 になるまで
        b--;
        a++;
    }
}
` },
  { id: 'mul', name: '掛け算 2 × 3（足し算の繰り返し）', expect: { a: 2, b: 0, c: 6 }, src:
`// 掛け算: c ← a × b（a を b 回足す）
unsigned char a = 2, b = 3, c = 0;

void main(void) {
    while (b) {
        b--;
        c += a;      // ADD 命令 1 つ
    }
}
` },
  { id: 'shiftmul', name: '2 進の掛け算 13 × 11（シフトと加算）', expect: { p: 143, b: 0 }, src:
`// 筆算と同じ 2 進の掛け算: p ← a × b
//   b の最下位ビットが 1 なら p に a を足し、
//   a を 2 倍（左シフト）、b を半分（右シフト）にして繰り返す
unsigned char a = 13, b = 11, p = 0, t;

void main(void) {
    while (b) {
        t = b >> 1;
        t <<= 1;          // t = b の最下位ビットを 0 にしたもの
        if (t != b)       // 違う = 最下位ビットが 1
            p += a;
        a <<= 1;
        b >>= 1;
    }
}
` },
  { id: 'newton', name: 'ニュートン法 ⌊√200⌋', expect: { x: 14 }, src:
`// ニュートン法で整数平方根 ⌊√N⌋ を求める
//   f(x) = x² − N の零点へ  x ← x − f(x)/f'(x) = (x + N/x) / 2
//   x が減らなくなったら収束（答え 14、√200 = 14.142…）
unsigned char N = 200, x = 200, y, q, r;

void main(void) {
    while (1) {
        q = 0;              // q ← N / x（引き算の繰り返しで割る）
        r = N;
        while (r >= x) {
            r -= x;
            q++;
        }
        y = x + q;          // y ← (x + N/x) / 2
        y >>= 1;
        if (y >= x)         // 減らなくなった → 収束
            break;
        x = y;
    }
}
` },
  { id: 'euler', name: 'オイラー法 dy/dt = −y/8', expect: { y: 56, n: 0 }, src:
`// オイラー法: dy/dt = −y/8 を Δt = 1 で 10 歩
//   y ← y + Δt·(−y/8) = y − (y >> 3)
//   厳密解 y(10) = 200·e^(−1.25) ≈ 57.3
//   実数のオイラー法 200·(7/8)^10 ≈ 52.6、整数の切り捨てで 56
unsigned char y = 200, n = 10, t;

void main(void) {
    while (n) {
        t = y >> 3;         // t = y / 8（右シフト 3 回）
        y -= t;             // y ← y − Δt·y/8
        n--;
    }
}
` },
  { id: 'fall', name: 'オイラー法 自由落下 x″ = g', expect: { x: 90, v: 20 }, src:
`// オイラー法で自由落下: dv/dt = g, dx/dt = v（Δt = 1, g = 2）
//   x ← x + v·Δt,  v ← v + g·Δt を 10 歩
//   オイラー法 x(10) = 90、厳密解 g·t²/2 = 100（Δt が大きい誤差）
unsigned char x = 0, v = 0, g = 2, n = 10;

void main(void) {
    while (n) {
        x += v;             // 位置を古い速度で進める
        v += g;
        n--;
    }
}
` },
  { id: 'gcd', name: 'ユークリッドの互除法 gcd(84, 36)', expect: { a: 12, b: 12 }, src:
`// ユークリッドの互除法（引き算版）: gcd(a, b)
unsigned char a = 84, b = 36;

void main(void) {
    while (a != b) {
        if (a > b) a -= b;
        else       b -= a;
    }
}
` },
  { id: 'fib', name: 'フィボナッチ数 F(12)', expect: { a: 89, b: 144, n: 0 }, src:
`// フィボナッチ数: F(0)=0, F(1)=1, F(k+1) = F(k) + F(k−1)
//   n 回まわすと b = F(n+1)。F(12) = 144
unsigned char n = 11, a = 0, b = 1, t;

void main(void) {
    while (n) {
        t = a + b;
        a = b;
        b = t;
        n--;
    }
}
` },
  { id: 'parity', name: '偶奇判定 5 mod 2（if / else）', expect: { a: 0, d: 1 }, src:
`// d ← a mod 2（偶数なら 0、奇数なら 1）
unsigned char a = 5, d = 0;

void main(void) {
    while (a) {
        a--;
        if (d) d--;
        else   d++;
    }
}
` },
  { id: 'wrap', name: '8bit の桁あふれ 250 + 9', expect: { a: 3 }, src:
`// unsigned char は 256 で一周する（C = 1 になる）
unsigned char a = 250, b = 9;

void main(void) {
    a += b;          // 259 mod 256 = 3
}
` },
];
if (typeof module !== 'undefined' && module.exports) module.exports = PROGRAMS;
root.CPU5_PROGRAMS = PROGRAMS;
})(typeof window !== 'undefined' ? window : globalThis);
