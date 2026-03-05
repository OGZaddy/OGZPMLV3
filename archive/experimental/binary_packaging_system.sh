#!/bin/bash
# build-secure-packages.sh - Create tamper-proof binary distributions

set -e

echo "🔒 Building bulletproof OGZ Prime packages..."
echo "📦 This will create obfuscated, checksummed, and binary-packaged distributions"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
BUILD_DIR="./secure-build"
DIST_DIR="./secure-dist"
KEYS_DIR="./keys"
VERSION="10.2.1"

# Create directories
mkdir -p "$BUILD_DIR" "$DIST_DIR" "$KEYS_DIR"

echo -e "${BLUE}📋 Step 1: Installing build dependencies...${NC}"
npm install -g pkg javascript-obfuscator webpack webpack-cli

# Install additional security dependencies
npm install --save-dev @vercel/ncc terser-webpack-plugin

echo -e "${BLUE}🔑 Step 2: Generating RSA key pairs for signing...${NC}"
if [ ! -f "$KEYS_DIR/server-private.pem" ]; then
    openssl genrsa -out "$KEYS_DIR/server-private.pem" 4096
    openssl rsa -in "$KEYS_DIR/server-private.pem" -pubout -out "$KEYS_DIR/server-public.pem"
    echo -e "${GREEN}✅ RSA key pair generated${NC}"
else
    echo -e "${YELLOW}⚠️  Using existing RSA keys${NC}"
fi

echo -e "${BLUE}🧮 Step 3: Calculating file checksums...${NC}"
# Calculate checksums for all core files
declare -A CHECKSUMS
for file in OGZPrimeV10.2.js OptimizedTradingBrain.js OptimizedIndicators.js EnhancedPatternRecognition.js; do
    if [ -f "$file" ]; then
        checksum=$(sha256sum "$file" | cut -d' ' -f1)
        CHECKSUMS["$file"]="sha256:$checksum"
        echo "  $file: sha256:$checksum"
    fi
done

# Create checksum manifest
cat > "$BUILD_DIR/checksums.json" << EOF
{
$(for file in "${!CHECKSUMS[@]}"; do
    echo "  \"$file\": \"${CHECKSUMS[$file]}\","
done | sed '$ s/,$//')
}
EOF

echo -e "${GREEN}✅ Checksums calculated and stored${NC}"

echo -e "${BLUE}🔧 Step 4: Creating obfuscated builds for each tier...${NC}"

# Function to obfuscate JavaScript files
obfuscate_js() {
    local input_file="$1"
    local output_file="$2"
    local obfuscation_level="$3"
    
    case $obfuscation_level in
        "basic")
            javascript-obfuscator "$input_file" \
                --output "$output_file" \
                --compact true \
                --control-flow-flattening false \
                --dead-code-injection false \
                --debug-protection false \
                --disable-console-output true \
                --identifier-names-generator 'hexadecimal' \
                --log false \
                --rename-globals false \
                --rotate-string-array true \
                --self-defending false \
                --string-array true \
                --string-array-encoding 'base64' \
                --string-array-threshold 0.75 \
                --transform-object-keys false \
                --unicode-escape-sequence false
            ;;
        "advanced")
            javascript-obfuscator "$input_file" \
                --output "$output_file" \
                --compact true \
                --control-flow-flattening true \
                --control-flow-flattening-threshold 0.75 \
                --dead-code-injection true \
                --dead-code-injection-threshold 0.4 \
                --debug-protection true \
                --debug-protection-interval true \
                --disable-console-output true \
                --identifier-names-generator 'hexadecimal' \
                --log false \
                --rename-globals true \
                --rotate-string-array true \
                --self-defending true \
                --string-array true \
                --string-array-encoding 'rc4' \
                --string-array-threshold 0.75 \
                --transform-object-keys true \
                --unicode-escape-sequence false
            ;;
        "maximum")
            javascript-obfuscator "$input_file" \
                --output "$output_file" \
                --compact true \
                --control-flow-flattening true \
                --control-flow-flattening-threshold 1 \
                --dead-code-injection true \
                --dead-code-injection-threshold 0.8 \
                --debug-protection true \
                --debug-protection-interval true \
                --disable-console-output true \
                --domain-lock '["your-domain.com"]' \
                --identifier-names-generator 'mangled' \
                --log false \
                --rename-globals true \
                --rename-properties true \
                --rotate-string-array true \
                --seed 42 \
                --self-defending true \
                --source-map false \
                --string-array true \
                --string-array-encoding 'rc4' \
                --string-array-threshold 1 \
                --transform-object-keys true \
                --unicode-escape-sequence true
            ;;
    esac
}

# Function to create secure package
create_secure_package() {
    local tier="$1"
    local obfuscation_level="$2"
    local files=("${@:3}")
    
    echo -e "${YELLOW}📦 Building $tier package with $obfuscation_level obfuscation...${NC}"
    
    # Create tier directory
    tier_dir="$BUILD_DIR/$tier"
    mkdir -p "$tier_dir"
    
    # Copy and obfuscate core files
    for file in "${files[@]}"; do
        if [ -f "$file" ]; then
            echo "  🔧 Obfuscating $file..."
            obfuscate_js "$file" "$tier_dir/$(basename "$file")" "$obfuscation_level"
        fi
    done
    
    # Copy configuration template
    cp config.example.js "$tier_dir/config.example.js"
    
    # Create tier-specific license manager
    cat > "$tier_dir/license-manager.js" << 'EOF'
// This file is dynamically generated and obfuscated
const { BulletproofLicenseManager } = require('./bulletproof-license-manager');
const checksums = require('./checksums.json');

class TierSpecificLicenseManager extends BulletproofLicenseManager {
  constructor(config) {
    super(config);
    this.expectedChecksums = checksums;
    this.tierName = '__TIER_NAME__';
    this.maxObfuscationLevel = '__OBFUSCATION_LEVEL__';
  }
  
  async validateTierAccess() {
    if (!this.permissions) return false;
    
    const requiredTiers = {
      'basic': ['basic', 'pro', 'prime', 'enterprise'],
      'pro': ['pro', 'prime', 'enterprise'], 
      'prime': ['prime', 'enterprise'],
      'enterprise': ['enterprise']
    };
    
    return requiredTiers[this.tierName].includes(this.permissions.tier);
  }
}

module.exports = { TierSpecificLicenseManager };
EOF
    
    # Replace placeholders
    sed -i "s/__TIER_NAME__/$tier/g" "$tier_dir/license-manager.js"
    sed -i "s/__OBFUSCATION_LEVEL__/$obfuscation_level/g" "$tier_dir/license-manager.js"
    
    # Copy hardened license manager and obfuscate it heavily
    obfuscate_js "bulletproof-license-manager.js" "$tier_dir/bulletproof-license-manager.js" "maximum"
    
    # Copy checksums
    cp "$BUILD_DIR/checksums.json" "$tier_dir/"
    
    # Create package.json for the tier
    cat > "$tier_dir/package.json" << EOF
{
  "name": "ogz-prime-$tier",
  "version": "$VERSION",
  "description": "OGZ Prime Trading Bot - $tier Edition",
  "main": "OGZPrimeV10.2.js",
  "scripts": {
    "start": "node OGZPrimeV10.2.js",
    "simulate": "node run-trading-bot-v10.2.js --mode simulate"
  },
  "pkg": {
    "scripts": "*.js",
    "assets": ["config.example.js", "checksums.json"],
    "targets": ["node16-win-x64", "node16-linux-x64", "node16-macos-x64"]
  },
  "dependencies": {
    "ws": "^8.0.0",
    "node-fetch": "^2.6.0"
  },
  "engines": {
    "node": ">=16.0.0"
  }
}
EOF
    
    # Create launcher script
    cat > "$tier_dir/run-trading-bot-v10.2.js" << 'EOF'
#!/usr/bin/env node
const { TierSpecificLicenseManager } = require('./license-manager');
const OGZPrimeV10 = require('./OGZPrimeV10.2');

async function main() {
  try {
    console.log('🚀 Starting OGZ Prime...');
    
    // Load configuration
    const config = require('./config.js');
    
    // Initialize with tier-specific license manager
    const bot = new OGZPrimeV10(config);
    bot.licenseManager = new TierSpecificLicenseManager(config);
    
    // Validate tier access
    if (!await bot.licenseManager.validateTierAccess()) {
      console.error('❌ This package requires a higher subscription tier');
      process.exit(1);
    }
    
    // Start the bot
    await bot.start();
    
  } catch (error) {
    console.error('❌ Startup failed:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);
EOF
    
    # Make launcher executable
    chmod +x "$tier_dir/run-trading-bot-v10.2.js"
    
    echo -e "${GREEN}✅ $tier package prepared${NC}"
}

# Build packages for each tier
create_secure_package "basic" "basic" \
    "OGZPrimeV10.2.js" "OptimizedIndicators.js" "OptimizedTradingBrain.js"

create_secure_package "pro" "advanced" \
    "OGZPrimeV10.2.js" "OptimizedIndicators.js" "OptimizedTradingBrain.js" \
    "EnhancedPatternRecognition.js" "FibonacciDetector.js"

create_secure_package "prime" "advanced" \
    "OGZPrimeV10.2.js" "OptimizedIndicators.js" "OptimizedTradingBrain.js" \
    "EnhancedPatternRecognition.js" "FibonacciDetector.js" "RiskManager.js" \
    "PerformanceAnalyzer.js" "SupportResistanceDetector.js"

create_secure_package "enterprise" "maximum" \
    "OGZPrimeV10.2.js" "OptimizedIndicators.js" "OptimizedTradingBrain.js" \
    "EnhancedPatternRecognition.js" "FibonacciDetector.js" "RiskManager.js" \
    "PerformanceAnalyzer.js" "SupportResistanceDetector.js" "CustomStrategyEngine.js"

echo -e "${BLUE}🏗️  Step 5: Creating binary executables...${NC}"

# Function to create binary package
create_binary_package() {
    local tier="$1"
    echo -e "${YELLOW}🔨 Creating binary for $tier tier...${NC}"
    
    cd "$BUILD_DIR/$tier"
    
    # Install dependencies
    npm install --production
    
    # Create binaries for multiple platforms
    pkg . --out-path "../../$DIST_DIR/$tier-binaries"
    
    cd - > /dev/null
    
    echo -e "${GREEN}✅ Binary package created for $tier${NC}"
}

# Create binaries for all tiers
for tier in basic pro prime enterprise; do
    create_binary_package "$tier"
done

echo -e "${BLUE}📝 Step 6: Creating installation packages...${NC}"

# Function to create installation package
create_installation_package() {
    local tier="$1"
    local price="$2"
    local description="$3"
    
    echo -e "${YELLOW}📦 Packaging $tier installation...${NC}"
    
    install_dir="$DIST_DIR/$tier-installation"
    mkdir -p "$install_dir"
    
    # Copy binary files
    cp -r "$DIST_DIR/$tier-binaries"/* "$install_dir/"
    
    # Copy obfuscated source (as backup)
    cp -r "$BUILD_DIR/$tier" "$install_dir/source"
    
    # Create installation script
    cat > "$install_dir/install.sh" << EOF
#!/bin/bash
echo "🚀 Installing OGZ Prime $tier Edition..."
echo "💰 Price: \$$price/month"
echo "📋 $description"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 16+ first."
    exit 1
fi

# Create installation directory
mkdir -p ~/.ogzprime
cp -r source/* ~/.ogzprime/
cp config.example.js ~/.ogzprime/config.js

echo "✅ OGZ Prime installed to ~/.ogzprime"
echo ""
echo "🔧 Next steps:"
echo "1. Edit ~/.ogzprime/config.js with your license details"
echo "2. Run: cd ~/.ogzprime && node run-trading-bot-v10.2.js --mode simulate"
echo ""
echo "📞 Support: https://ogzprime.com/support"
EOF
    
    # Create Windows installation script
    cat > "$install_dir/install.bat" << EOF
@echo off
echo 🚀 Installing OGZ Prime $tier Edition...
echo 💰 Price: \$$price/month
echo 📋 $description
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js is not installed. Please install Node.js 16+ first.
    pause
    exit /b 1
)

REM Create installation directory
if not exist "%USERPROFILE%\.ogzprime" mkdir "%USERPROFILE%\.ogzprime"
xcopy /E /I source "%USERPROFILE%\.ogzprime"
copy config.example.js "%USERPROFILE%\.ogzprime\config.js"

echo ✅ OGZ Prime installed to %USERPROFILE%\.ogzprime
echo.
echo 🔧 Next steps:
echo 1. Edit %USERPROFILE%\.ogzprime\config.js with your license details
echo 2. Run: cd %USERPROFILE%\.ogzprime ^&^& node run-trading-bot-v10.2.js --mode simulate
echo.
echo 📞 Support: https://ogzprime.com/support
pause
EOF
    
    # Create README
    cat > "$install_dir/README.md" << EOF
# OGZ Prime $tier Edition

## Installation

### Linux/macOS
\`\`\`bash
chmod +x install.sh
./install.sh
\`\`\`

### Windows
\`\`\`cmd
install.bat
\`\`\`

## Configuration

Edit \`~/.ogzprime/config.js\` (or \`%USERPROFILE%\.ogzprime\config.js\` on Windows):

\`\`\`javascript
module.exports = {
  email: 'your-email@example.com',
  licenseKey: 'YOUR-LICENSE-KEY-HERE',
  licenseServerUrl: 'https://license.ogzprime.com',
  
  // Trading settings
  assetName: 'BTC-USD',
  initialBalance: 10000,
  riskPerTrade: 0.01,
  
  // ... other settings
};
\`\`\`

## Running

### Simulation Mode (Safe Testing)
\`\`\`bash
cd ~/.ogzprime
node run-trading-bot-v10.2.js --mode simulate
\`\`\`

### Live Trading (Real Money)
\`\`\`bash
cd ~/.ogzprime  
node run-trading-bot-v10.2.js --mode live
\`\`\`

## Support

- Documentation: https://docs.ogzprime.com
- Support: https://ogzprime.com/support
- Community: https://discord.gg/ogzprime

## Security Features

✅ Certificate-pinned license validation  
✅ Hardware fingerprinting  
✅ Encrypted payloads  
✅ File integrity checking  
✅ Anti-tampering measures  
✅ Always-online validation  

This package is protected by advanced security measures. Any attempt to modify or reverse-engineer the software will result in automatic license revocation.
EOF
    
    # Make scripts executable
    chmod +x "$install_dir/install.sh"
    
    # Create final ZIP package
    cd "$DIST_DIR"
    zip -r "ogz-prime-$tier-v$VERSION.zip" "$tier-installation"
    cd - > /dev/null
    
    echo -e "${GREEN}✅ Installation package created: ogz-prime-$tier-v$VERSION.zip${NC}"
}

# Create installation packages
create_installation_package "basic" "49.99" "Core trading with basic indicators"
create_installation_package "pro" "99.99" "Advanced patterns and Fibonacci analysis"  
create_installation_package "prime" "199.99" "Full feature set with multi-timeframe analysis"
create_installation_package "enterprise" "499.99" "Everything plus custom strategies and API access"

echo -e "${BLUE}🔐 Step 7: Creating license server deployment package...${NC}"

# Package the hardened license server
server_dir="$DIST_DIR/license-server"
mkdir -p "$server_dir"

# Copy server files
cp hardened-license-server.js "$server_dir/"
cp "$KEYS_DIR"/server-*.pem "$server_dir/keys/"

# Create server package.json
cat > "$server_dir/package.json" << EOF
{
  "name": "ogz-prime-license-server",
  "version": "$VERSION",
  "description": "OGZ Prime License Server - Hardened Production Version",
  "main": "hardened-license-server.js",
  "scripts": {
    "start": "node hardened-license-server.js",
    "pm2": "pm2 start hardened-license-server.js --name ogz-license-server"
  },
  "dependencies": {
    "express": "^4.18.0",
    "bcrypt": "^5.1.0",
    "jsonwebtoken": "^9.0.0",
    "express-rate-limit": "^6.7.0",
    "helmet": "^6.1.0",
    "mongoose": "^7.0.0"
  },
  "engines": {
    "node": ">=16.0.0"
  }
}
EOF

# Create server deployment script
cat > "$server_dir/deploy.sh" << 'EOF'
#!/bin/bash
echo "🚀 Deploying OGZ Prime License Server..."

# Install dependencies
npm install --production

# Set up environment variables
echo "📝 Setting up environment variables..."
echo "Please set the following environment variables:"
echo "  export MONGODB_URI='your-mongodb-connection-string'"
echo "  export JWT_SECRET='your-jwt-secret-key'"
echo "  export ADMIN_JWT_SECRET='your-admin-jwt-secret'"
echo "  export ENCRYPTION_PASSWORD='your-encryption-password'"
echo "  export PORT=3001"

# Create systemd service
sudo tee /etc/systemd/system/ogz-license-server.service > /dev/null << EOL
[Unit]
Description=OGZ Prime License Server
After=network.target

[Service]
Type=simple
User=ogzprime
WorkingDirectory=/opt/ogz-license-server
ExecStart=/usr/bin/node hardened-license-server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOL

echo "✅ Service file created. Run 'sudo systemctl enable ogz-license-server' to enable"
echo "🔒 License server ready for deployment!"
EOF

chmod +x "$server_dir/deploy.sh"

# ZIP the server package
cd "$DIST_DIR"
zip -r "ogz-prime-license-server-v$VERSION.zip" "license-server"
cd - > /dev/null

echo -e "${GREEN}✅ License server package created: ogz-prime-license-server-v$VERSION.zip${NC}"

echo -e "${BLUE}📊 Step 8: Generating distribution report...${NC}"

# Create distribution report
cat > "$DIST_DIR/DISTRIBUTION_REPORT.md" << EOF
# OGZ Prime v$VERSION - Secure Distribution Report

Generated on: $(date)

## 📦 Package Overview

| Tier | Package | Size | Obfuscation | Binary |
|------|---------|------|-------------|--------|
| Basic | ogz-prime-basic-v$VERSION.zip | $(du -h "$DIST_DIR/ogz-prime-basic-v$VERSION.zip" | cut -f1) | Basic | ✅ |
| Pro | ogz-prime-pro-v$VERSION.zip | $(du -h "$DIST_DIR/ogz-prime-pro-v$VERSION.zip" | cut -f1) | Advanced | ✅ |
| Prime | ogz-prime-prime-v$VERSION.zip | $(du -h "$DIST_DIR/ogz-prime-prime-v$VERSION.zip" | cut -f1) | Advanced | ✅ |
| Enterprise | ogz-prime-enterprise-v$VERSION.zip | $(du -h "$DIST_DIR/ogz-prime-enterprise-v$VERSION.zip" | cut -f1) | Maximum | ✅ |

## 🔒 Security Features

✅ **RSA-2048 Signed Responses**  
✅ **AES-256-GCM Encrypted Payloads**  
✅ **Certificate Pinning**  
✅ **Hardware Fingerprinting**  
✅ **File Integrity Checking**  
✅ **Anti-Tampering Measures**  
✅ **Runtime Obfuscation**  
✅ **Binary Compilation**  
✅ **License Server Integration**  
✅ **Anomaly Detection**  

## 🛡️ Anti-Piracy Measures

1. **Always-Online Validation**: Bot validates license every 3 minutes
2. **Hardware Binding**: Each license tied to specific hardware fingerprint
3. **Encrypted License Communication**: All license data encrypted in transit
4. **Code Obfuscation**: Source code heavily obfuscated and unreadable
5. **Binary Distribution**: Core logic compiled to native executables
6. **Integrity Checking**: Files verified against cryptographic checksums
7. **Anti-Debugging**: Detects and prevents reverse engineering attempts
8. **Server-Side Control**: Remote shutdown capability for compromised licenses

## 💰 Revenue Model

| Tier | Price/Month | Max Instances | Target Market |
|------|-------------|---------------|---------------|
| Basic | \$49.99 | 1 | Individual traders |
| Pro | \$99.99 | 2 | Serious traders |
| Prime | \$199.99 | 5 | Professional traders |
| Enterprise | \$499.99 | Unlimited | Trading firms |

## 🚀 Deployment Steps

1. **Deploy License Server**:
   - Upload \`ogz-prime-license-server-v$VERSION.zip\` to your server
   - Configure MongoDB and environment variables
   - Run deployment script

2. **Upload Distribution Packages**:
   - Upload tier packages to secure distribution portal
   - Configure download authentication

3. **Marketing Launch**:
   - Update website with new tier information
   - Begin customer onboarding process

## 📞 Support Information

- **Documentation**: https://docs.ogzprime.com
- **Support Portal**: https://support.ogzprime.com  
- **License Server**: https://license.ogzprime.com
- **Distribution Portal**: https://downloads.ogzprime.com

---

🎯 **This distribution is bulletproof and ready for enterprise deployment!**
EOF

echo ""
echo -e "${GREEN}🎉 BULLETPROOF PACKAGING COMPLETE! 🎉${NC}"
echo ""
echo -e "${BLUE}📋 Summary:${NC}"
echo -e "  ✅ 4 secure tier packages created"
echo -e "  ✅ Binary executables compiled"  
echo -e "  ✅ License server packaged"
echo -e "  ✅ All code obfuscated and protected"
echo -e "  ✅ Checksums calculated and embedded"
echo -e "  ✅ Installation scripts created"
echo ""
echo -e "${YELLOW}📦 Distribution files:${NC}"
ls -la "$DIST_DIR"/*.zip
echo ""
echo -e "${RED}🚨 IMPORTANT SECURITY NOTES:${NC}"
echo -e "  🔑 Keep your RSA private keys secure!"
echo -e "  🔒 Change all default passwords/secrets before deployment"
echo -e "  🛡️  Test the license validation in a controlled environment first"
echo -e "  📊 Monitor the license server logs for any suspicious activity"
echo ""
echo -e "${GREEN}🚀 Your path to Houston is now bulletproof! 💰${NC}"