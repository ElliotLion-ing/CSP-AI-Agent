# Security Response: axios Supply Chain Attack (2026-03-31)

## Incident Summary

**Date**: 2026-03-31  
**Affected Packages**: 
- `axios@1.14.1` (REMOVED from npm)
- `axios@0.30.4` (REMOVED from npm)
- `plain-crypto-js@4.2.1` (REMOVED from npm)

**Attack Vector**: Maintainer account hijack → Malicious dependency injection → RAT dropper via `postinstall` hook

**Reference**: https://www.stepsecurity.io/blog/axios-compromised-on-npm-malicious-versions-drop-remote-access-trojan

---

## Our Project Status: ✅ SECURE

### Version Check (Performed: 2026-04-01)

- **Currently Installed**: `axios@1.13.6` ✅
- **Safe Baseline**: `axios@1.14.0` (latest safe version)
- **Malicious Versions**: NOT installed
- **Malicious Dependency**: `plain-crypto-js` NOT found in `node_modules`

### Actions Taken

1. ✅ **Version Locked**: `axios` locked to `1.13.6` (removed `^` prefix)
2. ✅ **Override Added**: Prevents transitive dependencies from pulling malicious versions
3. ✅ **Security Scripts Added**:
   - `npm run audit` - Check for vulnerabilities
   - `npm run security-check` - Detect malicious `plain-crypto-js` package
4. ✅ **`.npmrc` Configuration**: Enhanced security settings

---

## Detection Commands

### Quick Security Check
```bash
# Check axios version
npm list axios

# Check for malicious dependency
npm list plain-crypto-js 2>&1 || echo "No plain-crypto-js found (good)"

# Check node_modules directory
ls node_modules/plain-crypto-js 2>/dev/null && echo "⚠️ COMPROMISED" || echo "✅ SAFE"
```

### Full Security Audit
```bash
npm run security-check
npm run audit
```

---

## Prevention Measures

### 1. Version Locking Strategy
```json
{
  "dependencies": {
    "axios": "1.13.6"  // No ^ or ~
  },
  "overrides": {
    "axios": "1.13.6"  // Force version across all dependencies
  }
}
```

### 2. CI/CD Best Practices
```bash
# Use npm ci instead of npm install
npm ci --ignore-scripts

# Run security checks before build
npm run security-check
npm audit --audit-level=high
```

### 3. Runtime Monitoring
- Monitor for unexpected network connections
- Watch for process spawning from `node_modules`
- Alert on file modifications in `node_modules` after install

---

## Indicators of Compromise (IOC)

If any of these are detected, **assume full system compromise**:

### File System
- **macOS**: `/Library/Caches/com.apple.act.mond`
- **Windows**: `%PROGRAMDATA%\wt.exe`
- **Linux**: `/tmp/ld.py`
- **All**: `node_modules/plain-crypto-js/` directory

### Network
- **C2 Domain**: `sfrclak.com`
- **C2 IP**: `142.11.206.73`
- **C2 URL**: `http://sfrclak.com:8000/6202033`
- **POST Bodies**: `packages.npm.org/product0|1|2`

### Process
- Unexpected `curl` connections to unknown domains
- `nohup python3` processes from temp directories
- Hidden PowerShell windows (`-WindowStyle Hidden`)
- Detached processes with `ppid: 1`

---

## Recovery Checklist (If Compromised)

- [ ] **Isolate System**: Disconnect from network immediately
- [ ] **Block C2**: Add `sfrclak.com` and `142.11.206.73` to firewall/DNS blocklist
- [ ] **Remove Artifacts**: Delete all IOC files listed above
- [ ] **Rotate Credentials**: All secrets accessible on compromised system
  - [ ] npm tokens
  - [ ] SSH private keys
  - [ ] Cloud credentials (AWS/GCP/Azure)
  - [ ] Environment variables in `.env`
  - [ ] Git credentials
- [ ] **Rebuild System**: Do NOT attempt in-place cleanup
- [ ] **Audit CI/CD**: Check all workflow runs during attack window
- [ ] **Rotate CI/CD Secrets**: All injected secrets in GitHub Actions/GitLab CI

---

## Future Protection

### Dependency Monitoring
```bash
# Regular audits (weekly)
npm audit

# Check for supply chain risks
npm outdated
npm view axios dist-tags
```

### Lock File Integrity
```bash
# Verify lock file hasn't been tampered
git diff package-lock.json

# Commit lock file changes explicitly
git add package-lock.json
```

### CI/CD Configuration
```yaml
# GitHub Actions example
- name: Install dependencies
  run: npm ci --ignore-scripts

- name: Security check
  run: |
    npm run security-check
    npm audit --audit-level=high
```

---

## Contact & References

**StepSecurity Analysis**: https://www.stepsecurity.io/blog/axios-compromised-on-npm-malicious-versions-drop-remote-access-trojan

**GitHub Issue**: axios/axios#10604

**Last Updated**: 2026-04-01  
**Next Review**: 2026-04-08 (weekly)
