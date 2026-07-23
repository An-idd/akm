# VHS 录屏脚本（https://github.com/charmbracelet/vhs）
# 生成 README 首屏 GIF：brew install vhs && vhs docs/demo.tape
Output docs/demo.gif
Set FontSize 18
Set Width 900
Set Height 480
Set Theme "Catppuccin Mocha"

Type "claude"
Enter
Sleep 1s
Type "继续上次的 AI 视频工具选型"
Enter
Sleep 3s
# 期望画面：Agent 开场引用账本条目 [5802983d] video-tool-pricing-comparison@v1
# 并基于上次口径继续，而不是重新推导。真实跑一遍即可，无需摆拍。
Sleep 5s
