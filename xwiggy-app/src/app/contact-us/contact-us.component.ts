import { Component, OnInit } from '@angular/core';
import {environment} from "../../environments/environment";
import {Router} from "@angular/router";
import {User} from "../app.component";
import {HttpClient} from "@angular/common/http";

@Component({
  standalone: false,
  selector: 'app-contact-us',
  templateUrl: './contact-us.component.html',
  styleUrls: ['./contact-us.component.css']
})
export class ContactUsComponent implements OnInit {

  modelUser: User = {
    username:'',
    password:'',
    email:'',
    phone:'',
    firstname:'',
    lastname:'',
    address:'',
    merchant:null
  };

  modelMessage:contact={
    name:'',
    email:'',
    message:''
  };


  constructor(private http:HttpClient, private router:Router) { }

  ngOnInit() {
    if(sessionStorage.getItem('userData')==null) {
      this.router.navigate(["login"]);
      return;
    }

    let userData = JSON.parse(sessionStorage.getItem('userData'));
    Object.assign(this.modelUser,userData);
  }

  sending:boolean=false;
  success:string=null;
  message:string=null;

  sendFeedback() {
    if (this.sending) return;
    this.success = null;
    this.message = null;
    this.sending = true;

    this.modelMessage.name=this.modelUser.firstname+this.modelUser.lastname;
    this.modelMessage.email=this.modelUser.email;

    let url = `${environment.apiUrl}/contact`;
    this.http.post <contact>(url,this.modelMessage).subscribe(
      res => {
        this.sending = false;
        if (res) {
          this.success = "Message sent - we'll get back to you soon";
          this.modelMessage.message = '';
        } else {
          this.message = "Couldn't send that. Please try again.";
        }
      },
      err=>{
        this.sending = false;
        this.message = "Couldn't send that. Please try again.";
      }
    )
  }

  clearLocal(){
    sessionStorage.clear();
  }
}



export interface contact {
  message:string;
  name:string;
  email:string;
}
