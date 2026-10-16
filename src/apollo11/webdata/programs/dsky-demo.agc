# ============================================================
#  DSKY 演示程序 —— 本模拟器自带示例（自行编写，用于自检与教学）
#  显示 PROG 11 / VERB 16 / NOUN 36，R1 从 1 累加到 99 后回零，
#  并点亮 COMP ACTY 与 KEY REL 指示灯。
#  约定：固定代码与常量都放在同一页，页内地址 >= 01400，
#        运行时 FB 指向该页（加载器自动设置）。
# ============================================================

# ---------------- 可擦变量 ----------------
SETLOC  100
R1VAL   ERASE   1
TMP     ERASE   1

# ---------------- 代码 ----------------
SETLOC  5400            # 第 2 页，页内 01400
        BANK    2

START   CAF     KPROG
        EXTEND
        WRITE   21
        CAF     KVERB
        EXTEND
        WRITE   22
        CAF     KNOUN
        EXTEND
        WRITE   23
        CAF     KLAMP
        EXTEND
        WRITE   27
        CAF     ZERO
        TS      R1VAL

LOOP    CAF     ONE
        AD      R1VAL
        TS      R1VAL
        EXTEND
        WRITE   24
        CAF     LIMIT
        AD      R1VAL
        EXTEND
        BZMF    LOOP
        TCF     START

# ---------------- 常量（同页高地址区）----------------
SETLOC  5700
        BANK    2
KPROG   DEC     11
KVERB   DEC     16
KNOUN   DEC     36
KLAMP   OCT     5
ONE     DEC     1
ZERO    OCT     0
LIMIT   DEC     -99
