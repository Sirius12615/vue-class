# 空堂媒合

這是一個使用 Vue 3 + 純 JavaScript 製作的空堂媒合網站。

## 功能

- 上傳 CSV 課表
- 讀取後端資料庫中的 CSV
- 自動分析學生空堂與媒合對象
- 前端、後端、資料庫都以 JavaScript / CSV 完成

## CSV 格式

欄位請使用：

姓名,星期,開始,結束,課程,教室

星期可填：一、二、三、四、五、六、日，或 Monday、Tuesday 等英文格式。

## 開發方式

1. 安裝套件

```sh
npm install
```

2. 啟動前後端

```sh
npm run dev
```

3. 開啟瀏覽器後即可使用。

## 其他指令

```sh
npm run dev:client
npm run dev:server
npm run build
npm run preview
```


發現系統中已存在名為「王柏宇」的學生。

1. 若此檔案是其他同學：請輸入新別名（例如：王柏宇 (2) 或 王柏宇-乙班 等）。
2. 若您想覆蓋舊課表：請清空此對話框，點選確定即可。
3. 若您想取消此次動作：請點選取消。
