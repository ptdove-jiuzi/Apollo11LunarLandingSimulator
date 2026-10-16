# ============================================================
#  数值计算演示（本模拟器自带示例，自行编写）
#  用 AGC 的 DV 指令做定点分数除法，结果送入 DSKY 的 R1,
#  再演示 MP 做乘法，结果送入 R2。
# ============================================================

SETLOC  100
RES     ERASE   2

SETLOC  5400
        BANK    2

START   CAF     KP              # PROG = 31
        EXTEND
        WRITE   21
        CAF     KV              # VERB = 06
        EXTEND
        WRITE   22
        CAF     KN              # NOUN = 40
        EXTEND
        WRITE   23

        CAF     FA              # 0.125
        EXTEND
        DV      FB              # ÷ 0.5 = 0.25
        TS      RES
        CAF     FB              # 0.5
        EXTEND
        MP      FB              # 0.5 × 0.5 = 0.25
        TS      RES + 1

LOOP    CAF     RES
        EXTEND
        WRITE   24
        CAF     RES + 1
        EXTEND
        WRITE   25
        TCF     LOOP

SETLOC  5700
        BANK    2
KP      DEC     31
KV      DEC     6
KN      DEC     40
FA      OCT     4000
FB      OCT     20000
