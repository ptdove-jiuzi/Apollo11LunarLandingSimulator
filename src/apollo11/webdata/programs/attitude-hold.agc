# ============================================================
#  姿态与油门控制演示（本模拟器自带示例，自行编写）
#  通过通道 030o 下发油门、031o 下发姿态模式，驱动飞船。
#  同时把任务模式号显示在 DSKY 上。
# ============================================================

SETLOC  100
CNT     ERASE   2

SETLOC  5400
        BANK    2

START   CAF     KP              # PROG = 20
        EXTEND
        WRITE   21
        CAF     KV              # VERB = 21
        EXTEND
        WRITE   22
        CAF     KN              # NOUN = 40
        EXTEND
        WRITE   23
        CAF     KZERO
        EXTEND
        WRITE   31              # 姿态模式 0 = 顺行
        CAF     KTHR
        EXTEND
        WRITE   30              # 油门指令
        CAF     KZERO
        TS      CNT

LOOP    CAF     KONE
        AD      CNT
        TS      CNT
        EXTEND
        WRITE   24              # R1 持续计时
        TCF     LOOP

SETLOC  5700
        BANK    2
KP      DEC     20
KV      DEC     21
KN      DEC     40
KONE    DEC     1
KZERO   OCT     0
KTHR    DEC     0
