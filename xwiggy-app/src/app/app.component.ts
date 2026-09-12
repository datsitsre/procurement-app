import { Component } from '@angular/core';

@Component({
  standalone: false,
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})



export class AppComponent {
  title = 'SpringFood-app';

  static total:number;

  static modelUser: User ={
    username:'',
    password:'',
    email:'',
    phone:'',
    firstname:'',
    lastname:'',
    address:'',
    merchant:null
  };

}
export interface User{
  username:string;
  password:string;
  firstname:string;
  lastname:string;
  email:string;
  address:string;
  // A string, not a number - a phone number isn't arithmetic, can start with 0, and a plain
  // 10-digit mobile number regularly exceeds what the backend's old `int` column could hold.
  phone:string;
  merchant:boolean;
}

