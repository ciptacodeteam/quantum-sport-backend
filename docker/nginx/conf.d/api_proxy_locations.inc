# Shared API proxy locations — included by HTTPS server blocks.
# Requires: $backend set, resolver configured in the parent server {}.

location /health {
    proxy_pass http://$backend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
    access_log off;
}

location /api/ {
    limit_req zone=api_limit burst=20 nodelay;

    proxy_pass http://$backend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
    proxy_read_timeout 300s;
    proxy_connect_timeout 75s;
    proxy_buffering off;
}

location /webhooks/ {
    limit_req zone=api_limit burst=50 nodelay;

    proxy_pass http://$backend;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
}

location /uploads/ {
    proxy_pass http://$backend;
    proxy_cache_valid 200 1d;
    proxy_cache_valid 404 1m;
    add_header X-Cache-Status $upstream_cache_status;
    expires 1d;
}

location / {
    limit_req zone=api_limit burst=10 nodelay;

    proxy_pass http://$backend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
    proxy_read_timeout 300s;
}

error_page 404 /404.html;
error_page 500 502 503 504 /50x.html;
location = /50x.html {
    root /usr/share/nginx/html;
}
