# handoff-notion MCP（一键接入 Notion + 自动校对）

三个工具：`quote_build`（見積草稿）· `proofread`（日英中商务校对）· `notion_push`（建 Notion 页）。

## 一键接入（Cursor / OpenCode MCP）

`~/.config/opencode/opencode.json`（或 Cursor 的 mcp 配置）加：

```json
{
  "mcp": {
    "handoff-notion": {
      "type": "local",
      "command": ["node", "/Users/bougiezoe/3DP-Agent-/mcp/notion/dist/index.js"],
      "enabled": true,
      "environment": {
        "NOTION_TOKEN": "secret_xxx",
        "NOTION_PARENT_ID": "xxx"
      }
    }
  }
}
```

Claude Desktop 则是 `claude_desktop_config.json` 的 `mcpServers` 加同款
（`command: node`，`args: [绝对路径/dist/index.js]`，env 同上）。

## Notion 准备（2 分钟）

1. https://www.notion.so/my-integrations 建 integration → 拿 `NOTION_TOKEN`
2. 建一个 page 或 database → Share → 把 integration 加进来
3. page/database 链接最后那串 id 就是 `NOTION_PARENT_ID`
4. 不填这两个也能用 `quote_build` + `proofread`，只有 `notion_push` 会报错提醒

## 校对规则（确定性，无 LLM）

- 日文 AM 正式用語：印刷→造形（見積书里写印刷会被当外行）
- 假零：`0–0g / $0.00` → `—`
- 无条件保证/絶対 → 警告加范围
