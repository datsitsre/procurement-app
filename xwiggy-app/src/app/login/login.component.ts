import { Component, OnInit } from '@angular/core';
import {environment} from "../../environments/environment";
import {HttpClient} from "@angular/common/http";
import {Router} from "@angular/router";
import {AppComponent, User} from "../app.component";


@Component({
  standalone: false,
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent implements OnInit {

  model:Login={
    username:'',
    password:''
  };

  message:string=null;
  loading:boolean=false;

  constructor(private http:HttpClient, private router:Router) { }

  ngOnInit() {
    if(sessionStorage.getItem('token'))
      this.router.navigate(['menu']);
  }

  sendFeedback(): void {
    this.message = null;
    this.loading = true;
    let url = `${environment.apiUrl}/login`;
    this.http.post<LoginResponse>(url,this.model).subscribe(
      res => {
        this.loading = false;
        sessionStorage.setItem('token', res.token);
        sessionStorage.setItem('userData', JSON.stringify(res.user));
        AppComponent.modelUser = res.user;
        if (!res.user.merchant) {
          this.router.navigate(['menu']);
        } else {
          this.router.navigate(['merchantMenu']);
        }
      },
      err=>{
        this.loading = false;
        sessionStorage.clear();
        this.message = err.status === 401
          ? "Username or password is wrong"
          : "Couldn't reach the server. Check your connection and try again.";
      }
    )
  }
}

export interface Login {
  username:string;
  password:string;
}

export interface LoginResponse {
  token:string;
  user:User;
}
