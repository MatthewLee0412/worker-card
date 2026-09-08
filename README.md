# Worker Card｜人才棒球卡与员工成本管理系统

一个轻量、开箱即用的人才画像与企业成本管理工具。项目采用原生 HTML、CSS、JavaScript 和 Node.js 构建，无第三方运行依赖，适合小团队在本地持续记录员工的优势、待发展能力和事实证据，同时管理员工档案、薪酬、差旅与设备成本。

## 功能特性

- **人才棒球卡**：按主人翁精神、开放心态、逻辑判断、学习适应、执行交付和协作沟通六个维度形成员工画像。
- **事实型评价**：每次评分都保留日期、来源、评价人和具体工作证据，自动汇总优势、关注方向与画像可信度。
- **员工档案**：维护姓名、部门、职位、角色画像、专业技能、入职日期、月薪基数和备注等信息。
- **薪酬记录**：按月记录基本工资、绩效、奖金、请假与迟到早退扣款，并自动计算实发金额。
- **薪酬规则**：可配置基本工资占比、月计薪天数和每日工时。
- **差旅成本**：记录员工差旅日期、金额和用途，并按员工、年度汇总。
- **设备采购**：记录设备分类、数量、单价、供应商及采购总额。
- **统计报表**：汇总年度薪酬、差旅、设备成本，展示月度趋势、部门占比和员工成本排行。
- **报表导出**：可导出 CSV 年度核算报表，使用 Excel 等表格工具打开。
- **响应式界面**：兼容桌面端和移动端浏览器，并支持减少动画的系统偏好设置。

## 技术栈

- 前端：原生 HTML、CSS、JavaScript
- 后端：Node.js 原生 `http` 模块
- 数据存储：本地 JSON 文件
- 默认端口：`3817`

项目没有 `npm` 依赖，不需要执行 `npm install`。

## 快速开始

### 环境要求

请先安装 [Node.js](https://nodejs.org/)（建议使用当前 LTS 版本）。

### 获取项目

```bash
git clone https://github.com/MatthewLee0412/worker-card.git
cd worker-card
```

### 启动服务

Windows 用户可以双击 `start.bat`，脚本会启动服务并打开浏览器。

需要停止服务时，双击 `stop.bat`。脚本只会停止当前项目在对应端口上运行的 Node.js 服务；如果设置了 `PORT` 环境变量，启动和停止时请使用相同的值。

也可以在任意系统的终端中运行：

```bash
node server.js
```

然后访问：

```text
http://localhost:3817
```

如需修改端口，可在启动前设置 `PORT` 环境变量。例如在 PowerShell 中：

```powershell
$env:PORT = 4000
node server.js
```

## 数据说明

运行数据保存在 `data` 目录下：

| 文件 | 内容 |
| --- | --- |
| `employees.json` | 员工档案 |
| `salary.json` | 薪酬记录 |
| `travel.json` | 差旅记录 |
| `equipment.json` | 设备采购记录 |
| `assessments.json` | 员工能力观察与评分证据 |
| `settings.json` | 薪酬计算规则 |

仓库提供了对应的 `*.example.json` 示例模板。首次启动时，如果实际数据文件不存在，服务会自动复制示例模板进行初始化。

员工、薪酬、差旅和设备的实际运行数据已加入 `.gitignore`，后续修改不会被 Git 提交。需要迁移或备份数据时，请单独复制这些 JSON 文件。

## 项目结构

```text
worker-card/
├── data/                       # 数据与示例模板
│   ├── employees.example.json
│   ├── salary.example.json
│   ├── travel.example.json
│   ├── equipment.example.json
│   ├── assessments.example.json
│   └── settings.json
├── public/                     # 浏览器端页面
│   ├── index.html
│   ├── app.js
│   └── style.css
├── server.js                   # HTTP 服务与数据接口
├── start.bat                   # Windows 快速启动脚本
├── stop.bat                    # Windows 快速停止脚本
├── stop.ps1                    # 停止服务的 PowerShell 逻辑
└── .gitignore
```

## 使用建议

- 本项目定位为本地或受信任内网中的轻量工具。
- 当前没有用户登录、权限控制和数据库并发机制，请勿将服务端口直接暴露到公网。
- 正式使用前，请制定数据备份方案，并妥善保护包含员工和薪酬信息的 JSON 文件。
- 删除员工时，其关联的薪酬和差旅记录也会被一并删除，请谨慎操作。

## 开发说明

修改前端文件后刷新浏览器即可看到变化；修改 `server.js` 后需要重启服务。

提交代码前可以运行以下命令进行 JavaScript 语法检查：

```bash
node --check server.js
node --check public/app.js
```
