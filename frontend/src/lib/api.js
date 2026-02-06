import axios from "axios";
import { getIdToken } from "firebase/auth";
import { auth } from "../firebase.js";

const rawBaseUrl = import.meta.env.VITE_API_BASE_URL || "";
const normalizedBase = rawBaseUrl.trim().replace(/\s+/g, "").replace(/%20/g, "");
const baseURL = normalizedBase.endsWith("/api/api")
  ? normalizedBase.replace(/\/api\/api$/, "/api")
  : normalizedBase;

if (import.meta.env.DEV) {
  console.log(`VITE_API_BASE_URL=${import.meta.env.VITE_API_BASE_URL}`);
}

const api = axios.create({
  baseURL
});

api.interceptors.request.use(async (config) => {
  if (typeof config.url === "string" && config.baseURL) {
    const trimmedBase = String(config.baseURL).replace(/\/+$/, "");
    const urlPath = config.url;
    if (trimmedBase.endsWith("/api") && urlPath.startsWith("/api/")) {
      config.url = urlPath.replace(/^\/api/, "");
    }
  }
  const user = auth.currentUser;
  if (!user) {
    const error = new Error("Sesi\u00f3n vencida, volv\u00e9 a iniciar sesi\u00f3n");
    error.response = { status: 401, data: { message: error.message } };
    return Promise.reject(error);
  }
  const token = await getIdToken(user, true);
  config.headers = config.headers || {};
  config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (import.meta.env.DEV && error?.config) {
      const { method, url, baseURL: reqBaseURL } = error.config;
      const status = error?.response?.status;
      console.error("[API_ERROR]", { method, url, baseURL: reqBaseURL, status });
    }
    return Promise.reject(error);
  }
);

export { api };

