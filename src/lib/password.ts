import argon2 from "argon2";

import { env } from "../config/env.js";

export const hashPassword = async (password: string) =>
  argon2.hash(`${password}${env.PASSWORD_PEPPER}`, {
    type: argon2.argon2id
  });

export const verifyPassword = async (password: string, passwordHash: string) =>
  argon2.verify(passwordHash, `${password}${env.PASSWORD_PEPPER}`);
