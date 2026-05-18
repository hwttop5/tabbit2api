# npm 发布

## 目标

把 `tabbit2api` 发布到 npm 官方 registry，并确保用户可以通过下面两种方式使用：

```powershell
npx tabbit2api
```

```powershell
npm i -g tabbit2api
tabbit2api
```

## 发布前准备

本机若默认使用镜像 registry，发布时必须显式使用 npm 官方：

```powershell
npm login --registry=https://registry.npmjs.org
```

检查当前发布名是否存在：

```powershell
npm view tabbit2api --registry=https://registry.npmjs.org
```

## 本地验证

运行测试：

```powershell
npm test
```

检查发布内容：

```powershell
npm pack --dry-run --json --registry=https://registry.npmjs.org
```

验证 tarball 的 `npx` / `npm exec` 路径：

```powershell
npm pack --registry=https://registry.npmjs.org
npm exec --yes --package .\\tabbit2api-<version>.tgz -- tabbit2api --version
```

验证临时全局安装：

```powershell
npm install -g --prefix "$env:TEMP\\tabbit2api-global" .\\tabbit2api-<version>.tgz
"$env:TEMP\\tabbit2api-global\\tabbit2api.cmd" doctor
```

验证运行时自检和健康检查：

```powershell
tabbit2api doctor
tabbit2api start
curl.exe http://127.0.0.1:50124/health
```

## 正式发布

```powershell
npm publish --registry=https://registry.npmjs.org --access public
```

## 发布后验证

检查 registry：

```powershell
npm view tabbit2api version --registry=https://registry.npmjs.org
```

检查命令入口：

```powershell
npx tabbit2api --version
```

## 说明

- 本仓库不使用 `prepare` 自动安装 husky
- 开发者如需提交校验，手动执行：

```powershell
npm run hooks:install
```
