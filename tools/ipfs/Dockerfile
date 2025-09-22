FROM node:18-alpine
WORKDIR /app
COPY package.json ./
COPY package-lock.json ./
RUN npm ci --only=production
COPY . ./
## Admin now uses EIP-712 signature (provide ADMIN_PRIVATE_KEY). Do not commit secrets.
## Provide ADMIN_PRIVATE_KEY and PIN_SERVER_AES_KEY at runtime via your orchestrator's secrets mechanism.
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 8080 3002
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "pin-server.js"]
