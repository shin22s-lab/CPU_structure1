/* サンプルプログラム（C ソース）。expect は停止時の変数の期待値（テスト用） */
(function (root) {
const PROGRAMS = [
  { id: 'add', name: '足し算 2 + 3', expect: { a: 5, b: 0 }, src:
`// 足し算: a ← a + b
unsigned char a = 2;
unsigned char b = 3;

void main(void) {
    while (b) {      // b が 0 になるまで
        b--;
        a++;
    }
}
` },
  { id: 'mul', name: '掛け算 2 × 3', expect: { a: 2, b: 0, c: 6, d: 0 }, src:
`// 掛け算: c ← a × b   (d は作業用)
unsigned char a = 2, b = 3, c = 0, d = 0;

void main(void) {
    while (b) {
        b--;
        while (a) {      // c に a を足し、a を d に退避
            a--;
            c++;
            d++;
        }
        while (d) {      // a を元に戻す
            d--;
            a++;
        }
    }
}
` },
  { id: 'sub', name: '引き算 7 − 3（0 で止める）', expect: { a: 4, b: 0 }, src:
`// 引き算: a ← max(a − b, 0)
unsigned char a = 7, b = 3;

void main(void) {
    while (b != 0) {
        b--;
        if (a) a--;
    }
}
` },
  { id: 'parity', name: '偶奇判定 5 mod 2', expect: { a: 0, d: 1 }, src:
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
  { id: 'min', name: '最小値 min(4, 6)', expect: { a: 0, b: 2, c: 4 }, src:
`// c ← min(a, b)
unsigned char a = 4, b = 6, c = 0;

void main(void) {
    while (a) {
        if (b == 0) return;
        a--;
        b--;
        c++;
    }
}
` },
  { id: 'pow2', name: '2 のべき 2^3', expect: { a: 8, b: 0, c: 0 }, src:
`// a ← 2^b   (c は作業用)
unsigned char a = 1, b = 3, c = 0;

void main(void) {
    while (b) {
        b--;
        while (a) {      // c ← 2a
            a--;
            c++;
            c++;
        }
        while (c) {      // a ← c
            c--;
            a++;
        }
    }
}
` },
  { id: 'wrap', name: '8bit の桁あふれ 254 + 3', expect: { a: 1, b: 0 }, src:
`// unsigned char は 256 で一周する
unsigned char a = 254, b = 3;

void main(void) {
    while (b) {
        b--;
        a++;      // 254 → 255 → 0 → 1
    }
}
` },
  { id: 'clear', name: '代入 x = 0（脱糖）', expect: { a: 0, b: 2 }, src:
`// x = 0; は while (x) x--; に書き換えて翻訳される
unsigned char a = 3, b = 0;

void main(void) {
    a = 0;
    b++;
    b++;
}
` },
];
if (typeof module !== 'undefined' && module.exports) module.exports = PROGRAMS;
root.CPU5_PROGRAMS = PROGRAMS;
})(typeof window !== 'undefined' ? window : globalThis);
