FROM node:18-alpine
WORKDIR /app
COPY package.json ./
COPY package-lock.json ./
RUN npm ci --only=production
COPY . ./
ENV PIN_SERVER_API_KEY=dev-secret
ENV ADMIN_PRIVATE_KEY=priv
EXPOSE 8080 3002
CMD ["node", "pin-server.js"]
