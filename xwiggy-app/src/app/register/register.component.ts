import { Component, OnInit } from '@angular/core';
import {environment} from "../../environments/environment";
import {AppComponent, User} from "../app.component";
import {HttpClient} from "@angular/common/http";
import {Router} from "@angular/router";
import {LoginResponse} from "../login/login.component";

@Component({
  standalone: false,
  selector: 'app-register',
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.css']
})
export class RegisterComponent implements OnInit {

  constructor(private http:HttpClient, private router:Router) { }

  model:User={
    username:'',
    password:'',
    firstname:'',
    lastname:'',
    email:'',
    address:'',
    phone:null,
    merchant:null
  };

  // Matches the first <option> in the template - the <select> never reports a value to
  // ngModel until the user actually changes it, so if this started out null and the user
  // never touched the dropdown, updateSelect() below would throw on submit.
  options:string='User';
  present:boolean = null;
  usernameAvailability:string;
  fontColor:string;

  phoneValidation:boolean=true;
  emailValidation:boolean=true;
  passwordValidation:boolean=true;

  message:string=null;
  loading:boolean=false;
  checkingUsername:boolean=false;

  usernamePresent():void{
    if (!this.model.username) {
      return;
    }
    this.fontColor='';
    this.checkingUsername = true;
    let url = `${environment.apiUrl}/checkUserName`;

    this.http.post<boolean>(url,this.model.username).subscribe(
      res=>{
        this.checkingUsername = false;
        this.present=res;
        if(this.present) {
          this.fontColor="red";
          this.usernameAvailability = "UserName Already Taken";
        }
        else {
          this.fontColor="green";
          this.usernameAvailability = "Available";
        }
      },
      err=>{
        this.checkingUsername = false;
        this.message = "Couldn't check that username right now. Try again.";
      }
    )
  }

  updateSelect(){
      this.model.merchant = (this.options || 'User') !== 'User';
  }

  checkPhone()
  {
    let phone = String(this.model.phone);
    // Require exactly 10 digits - the old character class allowed '+'/spaces to stand in
    // for digits (e.g. "+ + + + + " passed), and never reset validity for other lengths.
    this.phoneValidation = /^[0-9]{10}$/.test(phone);
  }

  checkEmail(){
    // A minimal but real shape check (something@something.something) - the old version
    // only required an "@" to appear anywhere, so "a@" or "@@@" passed.
    this.emailValidation = this.model.email.length===0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.model.email);
  }

  passwordStrength(){
    if(this.model.password.length===0) {
      this.passwordValidation=true;
      return;
    }
    // The previous regex used (?=.{8,16}) - a lookahead, which only asserts "at least 8
    // characters exist from here", so the "at most 16" upper bound was never actually
    // enforced (a 40-character password satisfying the character classes still passed).
    let matcher = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*]).{8,16}$/;
    this.passwordValidation=matcher.test(this.model.password);
  }

  registerUser():void{
    this.updateSelect();
    this.message = null;
    this.loading = true;

    let url = `${environment.apiUrl}/register`;
    this.http.post<LoginResponse>(url,this.model).subscribe(
      res=>{
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
        this.message = typeof err.error === 'string' ? err.error : "Couldn't complete registration. Please try again.";
      }
    )
  }

  ngOnInit() {
  }

}
