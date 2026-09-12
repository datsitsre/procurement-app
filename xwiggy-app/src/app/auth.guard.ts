import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';

/** Blocks a route unless a JWT is present in this session. */
@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {
  constructor(private router: Router) { }

  canActivate(): boolean {
    if (sessionStorage.getItem('token')) {
      return true;
    }
    this.router.navigate(['login']);
    return false;
  }
}

/** Blocks a route unless the logged-in user is a merchant. */
@Injectable({ providedIn: 'root' })
export class MerchantGuard implements CanActivate {
  constructor(private router: Router) { }

  canActivate(): boolean {
    const token = sessionStorage.getItem('token');
    const userData = JSON.parse(sessionStorage.getItem('userData') || 'null');
    if (token && userData && userData.merchant) {
      return true;
    }
    this.router.navigate(['login']);
    return false;
  }
}
