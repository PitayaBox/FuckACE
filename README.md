# FuckACE
## FuckACE是一个用来优化所有使用ACE的游戏的免安装软件，可以一键设置ACE进程为效率模式和绑定到最后一个小核心，以降低ACE对电脑的性能影响。
### 喜欢的话请点点star，谢谢！Ciallo～(∠・ω<)⌒☆

最新版本下载（github的一般会延后发布）：
- [前往MikuGame下载最新版本](https://www.mikugame.icu/modpacks)
  
相关使用教程请看B站视频：
- [FuckACE使用教程](https://www.bilibili.com/video/BV1ePCnBpEWp/)

反馈问题，或者有什么建议都可以说喵＞﹏＜
- [提出建议！](https://github.com/shshouse/FuckACE/issues/new)

<img width="1343" height="948" alt="image" src="https://github.com/user-attachments/assets/06baae6b-16b6-4e9a-8ff8-5f2e6c3a93c0" />

注意：<br>
1.软件不会彻底关闭ACE，只是对其占用进行限制，别开桂嗷。<br>
2.主包测试了是没事的，但是不排除会误封的可能，请充分了解潜在风险，使用即代表已经了解并接受这些风险/(ㄒoㄒ)/~~

## 核心机制
### 1.被动限制：
通过注册表修改，一键降低ACE的CPU优先级和I/O优先级，同时提高对应游戏优先级。

### 2.主动限制：
在主动限制下，可以额外对ACE进行限制：<br>
1.绑定到最后一个核心(一般是小核)<br>
2.将ACE设置为效率模式(减低占用)<br>
3.降低ACE的内存优先性<br>

将被执行限制的进程：<br>
1.SGuard64.exe <br>
2.SGuardSvc64.exe <br>

## 开发者
- 开发者: [shshouse](https://github.com/shshouse)
- Bilibili: [shshouse](https://space.bilibili.com/3493127123897196)
- 爱发电: [shshouse](https://afdian.com/a/shshouse)

## 免责声明
本软件仅供技术研究和学习使用，使用本软件造成的任何后果由使用者自行承担。
