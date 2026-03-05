#!/bin/bash
# OGZ Prime Nginx Deployment Script
# Deploy with confidence! 🚀

set -e

echo "🚀 OGZ PRIME NGINX DEPLOYMENT SCRIPT"
echo "===================================="
echo ""

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo "❌ This script must be run as root (use sudo)" 
   exit 1
fi

# Function to check if nginx is installed
check_nginx() {
    if ! command -v nginx &> /dev/null; then
        echo "❌ Nginx is not installed!"
        echo "Install with: apt-get install nginx (Debian/Ubuntu)"
        echo "          or: yum install nginx (CentOS/RHEL)"
        exit 1
    fi
}

# Function to backup existing config
backup_config() {
    if [ -d "/etc/nginx" ]; then
        backup_dir="/etc/nginx.backup.$(date +%Y%m%d_%H%M%S)"
        echo "📦 Backing up existing nginx config to $backup_dir"
        cp -r /etc/nginx "$backup_dir"
    fi
}

# Function to copy SSL certificates
copy_ssl_certs() {
    echo "🔒 Setting up SSL certificates..."
    
    # Create SSL directory if it doesn't exist
    mkdir -p /etc/nginx/ssl
    
    # Check if local SSL certs exist
    if [ -f "../ssl/cert.pem" ] && [ -f "../ssl/key.pem" ]; then
        echo "   Copying local SSL certificates..."
        cp ../ssl/cert.pem /etc/nginx/ssl/
        cp ../ssl/key.pem /etc/nginx/ssl/
        chmod 644 /etc/nginx/ssl/cert.pem
        chmod 600 /etc/nginx/ssl/key.pem
    else
        echo "⚠️  No local SSL certificates found!"
        echo "   You'll need to:"
        echo "   1. Copy your certificates to /etc/nginx/ssl/"
        echo "   2. Or use Let's Encrypt: certbot --nginx -d ogzprime.com"
    fi
}

# Function to deploy configuration
deploy_config() {
    echo "🚀 Deploying nginx configuration..."
    
    # Copy main nginx.conf
    cp nginx.conf /etc/nginx/nginx.conf
    
    # Copy modular configurations
    cp -r sites-available /etc/nginx/
    cp -r sites-enabled /etc/nginx/
    cp -r conf.d /etc/nginx/
    cp -r snippets /etc/nginx/
    cp -r security /etc/nginx/
    
    # Create symbolic link for site
    ln -sf /etc/nginx/sites-available/ogzprime.com /etc/nginx/sites-enabled/ogzprime.com
    
    # Remove default site if exists
    rm -f /etc/nginx/sites-enabled/default
}

# Function to create web root
create_webroot() {
    echo "📁 Creating web root directory..."
    mkdir -p /var/www/ogzprime
    
    # Create a simple index.html if none exists
    if [ ! -f "/var/www/ogzprime/index.html" ]; then
        cat > /var/www/ogzprime/index.html <<EOF
<!DOCTYPE html>
<html>
<head>
    <title>OGZ Prime - Quantum Trading</title>
    <meta charset="utf-8">
    <style>
        body {
            background: #0a0a0a;
            color: #22c55e;
            font-family: monospace;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
        }
        .container {
            text-align: center;
        }
        h1 {
            font-size: 3em;
            margin-bottom: 20px;
            animation: glow 2s ease-in-out infinite alternate;
        }
        @keyframes glow {
            from { text-shadow: 0 0 10px #22c55e, 0 0 20px #22c55e; }
            to { text-shadow: 0 0 20px #22c55e, 0 0 30px #22c55e; }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>⚛️ OGZ PRIME QUANTUM</h1>
        <p>Trading Bot Infrastructure Online</p>
        <p>WebSocket: wss://ogzprime.com/ws</p>
    </div>
</body>
</html>
EOF
    fi
    
    # Set proper permissions
    chown -R www-data:www-data /var/www/ogzprime
}

# Function to test configuration
test_config() {
    echo "🧪 Testing nginx configuration..."
    nginx -t
    
    if [ $? -eq 0 ]; then
        echo "✅ Configuration test passed!"
    else
        echo "❌ Configuration test failed!"
        exit 1
    fi
}

# Function to restart nginx
restart_nginx() {
    echo "🔄 Restarting nginx..."
    systemctl restart nginx
    
    if [ $? -eq 0 ]; then
        echo "✅ Nginx restarted successfully!"
    else
        echo "❌ Failed to restart nginx!"
        exit 1
    fi
}

# Function to show status
show_status() {
    echo ""
    echo "📊 DEPLOYMENT STATUS"
    echo "==================="
    systemctl status nginx --no-pager | head -n 5
    echo ""
    echo "🌐 Your site should now be accessible at:"
    echo "   https://ogzprime.com"
    echo "   wss://ogzprime.com/ws (WebSocket)"
    echo ""
    echo "📝 Next steps:"
    echo "   1. Make sure your domain points to this server"
    echo "   2. Ensure your Node.js app is running on port 3010"
    echo "   3. Monitor logs: tail -f /var/log/nginx/error.log"
    echo ""
}

# Main deployment flow
echo "Starting deployment..."
echo ""

check_nginx
backup_config
copy_ssl_certs
deploy_config
create_webroot
test_config
restart_nginx
show_status

echo "🎉 DEPLOYMENT COMPLETE!"
echo "💪 FOR VICTORY! 💪"


# OGZ Prime Quantum Trading Bot - Nginx Configuration
# Optimized for high-frequency trading and WebSocket connections
# Built for VICTORY! 🚀

user nginx;
worker_processes auto;
worker_rlimit_nofile 65535;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 10000;
    use epoll;
    multi_accept on;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    
    # Logging format for monitoring
    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for" '
                    'rt=$request_time uct="$upstream_connect_time" '
                    'uht="$upstream_header_time" urt="$upstream_response_time"';
    
    access_log /var/log/nginx/access.log main;
    
    # Performance optimizations
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    keepalive_requests 100;
    types_hash_max_size 2048;
    server_tokens off;
    
    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml text/javascript application/json 
               application/javascript application/xml+rss application/rss+xml 
               application/atom+xml image/svg+xml;
    
    # Buffer sizes for large WebSocket messages
    client_body_buffer_size 16K;
    client_header_buffer_size 1k;
    client_max_body_size 16m;
    large_client_header_buffers 4 16k;
    
    # Timeouts
    client_body_timeout 12;
    client_header_timeout 12;
    send_timeout 10;
    
    # Rate limiting zones
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=30r/s;
    limit_req_zone $binary_remote_addr zone=ws_limit:10m rate=10r/s;
    limit_conn_zone $binary_remote_addr zone=conn_limit:10m;
    
    # Load modular configurations
    include /etc/nginx/conf.d/*.conf;
    include /etc/nginx/sites-enabled/*;
}


# WebSocket Configuration
# Optimized for real-time trading data streams

# Standard proxy headers
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;

# WebSocket specific headers - CRITICAL
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";

# Long timeouts for persistent connections
proxy_connect_timeout 7d;
proxy_send_timeout 7d;
proxy_read_timeout 7d;

# Disable buffering for real-time data
proxy_buffering off;
proxy_request_buffering off;

# HTTP version 1.1 required for WebSocket
proxy_http_version 1.1;

# Large buffer for trading data bursts
proxy_buffer_size 64k;
proxy_buffers 8 32k;
proxy_busy_buffers_size 128k;

# Disable cache for WebSocket
proxy_cache_bypass 1;
proxy_no_cache 1;

# Maximum WebSocket frame size (64MB for large data transfers)
proxy_max_temp_file_size 0;
client_max_body_size 64m;

# WebSocket ping/pong
proxy_socket_keepalive on;


# Proxy Parameters for Backend Communication
# Standard proxy headers for proper request forwarding

proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $server_name;
proxy_set_header X-Forwarded-Port $server_port;

# Proxy timeouts
proxy_connect_timeout 60s;
proxy_send_timeout 60s;
proxy_read_timeout 60s;

# Proxy buffering
proxy_buffering on;
proxy_buffer_size 4k;
proxy_buffers 8 4k;
proxy_busy_buffers_size 8k;

# Proxy caching
proxy_cache_bypass $http_upgrade;
proxy_no_cache $http_upgrade;

# HTTP version
proxy_http_version 1.1;

# Keep alive
proxy_set_header Connection "";

# OGZ Prime Quantum Trading Bot - Site Configuration
# HTTPS + WebSocket proxy for quantum trading operations

# HTTP redirect to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name ogzprime.com www.ogzprime.com;
    
    # ACME challenge for Let's Encrypt
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    
    # Redirect all other requests to HTTPS
    location / {
        return 301 https://$server_name$request_uri;
    }
}

# HTTPS server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ogzprime.com www.ogzprime.com;
    
    # SSL configuration
    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;
    
    # Modern SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers 'ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256';
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    ssl_stapling on;
    ssl_stapling_verify on;
    
    # Security headers
    include /etc/nginx/security/headers.conf;
    
    # Rate limiting
    include /etc/nginx/security/rate-limiting.conf;
    
    # Root directory - CHANGE THIS to your actual web root if needed
    root /var/www/ogzprime;
    index index.html;
    
    # Main location block
    location / {
        # First try to serve request as file, then as directory, then proxy to app
        try_files $uri $uri/ @proxy;
    }
    
    # Proxy to Node.js app
    location @proxy {
        include /etc/nginx/snippets/proxy-params.conf;
        proxy_pass http://quantum_backend;
    }
    
    # API endpoints
    location /api {
        include /etc/nginx/snippets/proxy-params.conf;
        proxy_pass http://quantum_backend;
        
        # API rate limiting
        limit_req zone=api_limit burst=50 nodelay;
    }
    
    # WebSocket endpoint - CRITICAL FOR TRADING BOT
    location /ws {
        include /etc/nginx/snippets/websocket.conf;
        proxy_pass http://quantum_backend;
        
        # WebSocket specific settings
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 7d;  # 7 days for long-lived connections
        proxy_send_timeout 7d;
        proxy_connect_timeout 75s;
        
        # Disable buffering for real-time data
        proxy_buffering off;
        
        # WebSocket rate limiting
        limit_req zone=ws_limit burst=20 nodelay;
        limit_conn conn_limit 100;
    }
    
    # Static files
    location ~* \.(jpg|jpeg|png|gif|ico|css|js|pdf|txt)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }
    
    # Deny access to hidden files
    location ~ /\. {
        deny all;
        access_log off;
        log_not_found off;
    }
    
    # Health check endpoint
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }
    
    # Error pages
    error_page 403 /403.html;
    error_page 404 /404.html;
    error_page 500 502 503 504 /50x.html;
    
    location = /403.html {
        root /usr/share/nginx/html;
        internal;
    }
    
    location = /50x.html {
        root /usr/share/nginx/html;
        internal;
    }
}

# Include additional server blocks if needed
include /etc/nginx/sites-available/*.conf;

# Rate Limiting Configuration
# Protect against DDoS and brute force attacks

# API endpoints - 30 requests per second with burst of 50
# Applied in location blocks with: limit_req zone=api_limit burst=50 nodelay;

# WebSocket connections - 10 per second with burst of 20
# Applied in location blocks with: limit_req zone=ws_limit burst=20 nodelay;

# Connection limiting - max 100 concurrent connections per IP
# Applied in location blocks with: limit_conn conn_limit 100;

# Return 429 Too Many Requests for rate limited requests
limit_req_status 429;
limit_conn_status 429;

# Custom error page for rate limiting
error_page 429 /429.html;
location = /429.html {
    root /usr/share/nginx/html;
    add_header Content-Type text/html;
    return 429 '<!DOCTYPE html>
<html>
<head>
    <title>Too Many Requests</title>
    <style>
        body {
            background: #0a0a0a;
            color: #dc2626;
            font-family: monospace;
            text-align: center;
            padding: 50px;
        }
        h1 { font-size: 3em; margin-bottom: 20px; }
        p { font-size: 1.2em; color: #aaa; }
        .retry { margin-top: 30px; color: #22c55e; }
    </style>
</head>
<body>
    <h1>⚠️ 429 - TOO MANY REQUESTS</h1>
    <p>Slow down there, speed racer! The quantum cores need a moment to cool down.</p>
    <p class="retry">Please try again in a few seconds...</p>
</body>
</html>';
}

# Security Headers for OGZ Prime
# Protecting your quantum trading infrastructure

# Prevent clickjacking
add_header X-Frame-Options "SAMEORIGIN" always;

# Prevent MIME type sniffing
add_header X-Content-Type-Options "nosniff" always;

# Enable XSS protection
add_header X-XSS-Protection "1; mode=block" always;

# Content Security Policy
add_header Content-Security-Policy "default-src 'self' https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self' wss://ogzprime.com wss://socket.polygon.io https://api.polygon.io;" always;

# Referrer Policy
add_header Referrer-Policy "strict-origin-when-cross-origin" always;

# Permissions Policy (formerly Feature Policy)
add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;

# HSTS (HTTP Strict Transport Security)
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;

# DNS Prefetch Control
add_header X-DNS-Prefetch-Control "on" always;

# Download Options
add_header X-Download-Options "noopen" always;

# Permitted Cross-Domain Policies
add_header X-Permitted-Cross-Domain-Policies "none" always;

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>403 - Access Denied | OGZ Prime</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            background: linear-gradient(135deg, #0a0a0a 0%, #1a0a1a 100%);
            color: #ffffff;
            font-family: 'Monaco', 'Consolas', monospace;
            height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            overflow: hidden;
        }
        
        .container {
            text-align: center;
            padding: 2rem;
            max-width: 600px;
        }
        
        .error-code {
            font-size: 8rem;
            font-weight: bold;
            color: #dc2626;
            text-shadow: 0 0 30px #dc2626, 0 0 60px #dc2626;
            margin-bottom: 1rem;
            animation: pulse 2s infinite;
        }
        
        .error-message {
            font-size: 2rem;
            margin-bottom: 1rem;
            color: #ef4444;
        }
        
        .description {
            font-size: 1.2rem;
            color: #a0a0a0;
            margin-bottom: 2rem;
            line-height: 1.6;
        }
        
        .actions {
            display: flex;
            gap: 1rem;
            justify-content: center;
            flex-wrap: wrap;
        }
        
        .btn {
            padding: 0.8rem 2rem;
            border: 2px solid #22c55e;
            background: transparent;
            color: #22c55e;
            text-decoration: none;
            border-radius: 4px;
            font-size: 1rem;
            transition: all 0.3s ease;
            display: inline-block;
        }
        
        .btn:hover {
            background: #22c55e;
            color: #0a0a0a;
            transform: translateY(-2px);
            box-shadow: 0 5px 20px rgba(34, 197, 94, 0.5);
        }
        
        .quantum-particles {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            z-index: -1;
        }
        
        .particle {
            position: absolute;
            background: #22c55e;
            width: 2px;
            height: 2px;
            border-radius: 50%;
            opacity: 0.5;
            animation: float 20s infinite linear;
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
        }
        
        @keyframes float {
            from {
                transform: translateY(100vh) translateX(0);
            }
            to {
                transform: translateY(-10vh) translateX(100px);
            }
        }
        
        .lock-icon {
            font-size: 4rem;
            margin-bottom: 1rem;
            animation: shake 2s infinite;
        }
        
        @keyframes shake {
            0%, 100% { transform: translateX(0); }
            10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
            20%, 40%, 60%, 80% { transform: translateX(5px); }
        }
    </style>
</head>
<body>
    <div class="quantum-particles" id="particles"></div>
    
    <div class="container">
        <div class="lock-icon">🔒</div>
        <div class="error-code">403</div>
        <div class="error-message">Access Denied</div>
        <div class="description">
            The quantum security protocols have detected unauthorized access attempt.
            <br>
            This area is restricted to authenticated OGZ Prime members only.
        </div>
        <div class="actions">
            <a href="/" class="btn">Return Home</a>
            <a href="/pricing.html" class="btn">Get Access</a>
        </div>
    </div>
    
    <script>
        // Generate quantum particles
        const particlesContainer = document.getElementById('particles');
        const particleCount = 50;
        
        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement('div');
            particle.className = 'particle';
            particle.style.left = Math.random() * 100 + '%';
            particle.style.animationDelay = Math.random() * 20 + 's';
            particle.style.animationDuration = (Math.random() * 20 + 10) + 's';
            particlesContainer.appendChild(particle);
        }
    </script>
</body>
</html>
# Upstream configuration for OGZ Quantum Trading Backend
# Load balancing and failover for high availability

upstream quantum_backend {
    # Least connections algorithm for better load distribution
    least_conn;
    
    # Primary backend server
    server 127.0.0.1:3010 max_fails=3 fail_timeout=30s;
    
    # Backup servers (add more as you scale)
    # server 127.0.0.1:3011 backup;
    # server 127.0.0.1:3012 backup;
    
    # Keep alive connections for better performance
    keepalive 32;
    keepalive_requests 100;
    keepalive_timeout 60s;
}

# Future: Multi-region backend pools
# upstream quantum_backend_us {
#     server us1.internal:3010 weight=5;
#     server us2.internal:3010 weight=5;
# }

# upstream quantum_backend_eu {
#     server eu1.internal:3010 weight=5;
#     server eu2.internal:3010 weight=5;
# }
